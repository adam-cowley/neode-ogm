import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { readdirSync } from 'fs';
import { basename, extname, resolve } from 'path';
import {
    ConnectionProvider,
    GraphRelationship,
    QueryOutput,
    QueryParams,
    Runner,
    TransactionHandle,
} from './driver/types';
import { Neo4jConnectionProvider } from './driver/neo4j';
import { RelateConnectionProvider } from './driver/relate';
import { getModel, getModels, resolveRepository } from './meta';
import { Newable } from './meta/newable';
import EntitySchema from './meta/entity/entity-schema';
import { PropertyType } from './meta/property-schema';
import RelationshipPropertySchema from './meta/relationship-property-schema';
import {
    defineModel,
    extendModel,
    getModelByName,
    unknownDefinitionError,
} from './meta/map-schema';
import { SchemaDefinition } from './meta/schema-definition.interface';
import { EventType, NeodeEventHandler } from './common/events';
import FindService from './services/query/find.service';
import MergeService from './services/query/merge.service';
import CreateService from './services/query/create.service';
import DeleteService, { DeleteOptions } from './services/query/delete.service';
import DetachService, { DetachResult } from './services/query/detach.service';
import INeode from './neode.interface';
import GetService, { OrderSpec } from './services/query/get.service';
import RelateService from './services/query/relate.service';
import UpdateService from './services/query/update.service';
import WithinDistanceService from './services/query/within-distance.service';
import SchemaService, { SchemaResult } from './services/schema/schema.service';
import { Repository } from '.';
import TransactionalService from './transaction/transactional.service';
import TransactionError, { BatchStatementError } from './transaction/errors';
import FindByIdService from './services/query/find-by-id.service';
import { INTERNAL_ID } from './constants';

export default class Neode implements INeode {
    private eventEmitter: EventEmitter = new EventEmitter();

    private database?: string;

    constructor(
        private readonly connection: ConnectionProvider,
        private enterprise: boolean = false
    ) {}

    /**
     * Create a Neode instance over a neo4j-driver Driver
     * (Neo4j Community / Enterprise, Memgraph, or any Bolt server)
     */
    static forDriver(driver: import('neo4j-driver').Driver, database?: string, enterprise = false): Neode {
        return new Neode(new Neo4jConnectionProvider(driver, database), enterprise);
    }

    /**
     * Create a Neode instance over an embedded Relate database
     * (in-memory or file-backed)
     */
    static forRelate(database: unknown, namespace = 'neo4j', enterprise = false): Neode {
        return new Neode(
            new RelateConnectionProvider(database as never, namespace),
            enterprise
        );
    }

    getConnection(): ConnectionProvider {
        return this.connection;
    }

    getRunner(): Runner {
        return this.connection;
    }

    isEnterprise(): boolean {
        return this.enterprise;
    }

    setEnterprise(enterprise: boolean): void {
        this.enterprise = enterprise;
    }

    /**
     * Set the default database for all future statements (neode parity).
     * A per-call `database` argument wins over this default, which in turn
     * wins over the provider's own constructor database.
     */
    setDatabase(database?: string): void {
        this.database = database;
    }

    /**
     * Subscribe to a lifecycle event — see EventType (common/events.ts).
     * Returns this for chaining.
     */
    on(event: EventType, handler: NeodeEventHandler): this {
        this.eventEmitter.on(event, handler);

        return this;
    }

    /** Unsubscribe a previously registered event handler. */
    off(event: EventType, handler: NeodeEventHandler): this {
        this.eventEmitter.off(event, handler);

        return this;
    }

    private getSchema(constructor: unknown): EntitySchema {
        const found = getModel(constructor);

        if (!found) {
            const name = (constructor as { name?: string })?.name || 'unknown';

            throw new Error(
                `Couldn't find a model for "${name}". Registered model(s) are: ${Array.from(
                    getModels().keys()
                )
                    .map((model) => (model as { name?: string }).name)
                    .join(', ')}`
            );
        }

        return found;
    }

    /**
     * The relationship declared on the schema under the given key
     * (neode's relateTo resolves the relationship by definition key)
     */
    private requireRelationship(schema: EntitySchema, key: string): RelationshipPropertySchema {
        if (!schema.hasRelationship(key)) {
            throw new Error(
                `Unknown relationship "${key}" on ${schema.getLabels().join(':') || 'entity'}`
            );
        }

        return schema.getRelationship(key);
    }

    /**
     * Run a single statement in an implicit transaction
     */
    readCypher(query: string, params: QueryParams = {}, database?: string): Promise<QueryOutput> {
        return this.connection.run(query, params, 'READ', database ?? this.database);
    }

    writeCypher(query: string, params: QueryParams = {}, database?: string): Promise<QueryOutput> {
        return this.connection.run(query, params, 'WRITE', database ?? this.database);
    }

    /**
     * Open an explicit READ transaction
     */
    async readTransaction(database?: string): Promise<TransactionHandle> {
        return this.connection.beginTransaction('READ', database ?? this.database);
    }

    /**
     * Open an explicit WRITE transaction
     */
    async writeTransaction(database?: string): Promise<TransactionHandle> {
        return this.connection.beginTransaction('WRITE', database ?? this.database);
    }

    /**
     * Open a transaction and return a TransactionalService
     * (remember to call .commit() or .rollback())
     */
    async openReadTransaction(database?: string): Promise<TransactionalService> {
        const handle = await this.readTransaction(database);

        return new TransactionalService(handle, this.eventEmitter);
    }

    /**
     * Open a transaction and return a TransactionalService
     * (remember to call .commit() or .rollback())
     */
    async openWriteTransaction(database?: string): Promise<TransactionalService> {
        const handle = await this.writeTransaction(database);

        return new TransactionalService(handle, this.eventEmitter);
    }

    /**
     * Run a unit of work within a READ transaction
     */
    async inReadTransaction<T>(
        work: (tx: TransactionalService) => Promise<T>,
        database?: string
    ): Promise<T> {
        const tx = await this.openReadTransaction(database);

        try {
            return await work(tx);
        } catch (e) {
            await tx.rollback().catch(() => {});
            throw e;
        }
    }

    /**
     * Run a unit of work within a WRITE transaction
     */
    async inWriteTransaction<T>(
        work: (tx: TransactionalService) => Promise<T>,
        database?: string
    ): Promise<T> {
        const tx = await this.openWriteTransaction(database);

        try {
            return await work(tx);
        } catch (e) {
            await tx.rollback().catch(() => {});
            throw e;
        }
    }

    /**
     * Run a batch of statements within ONE transaction (neode's batch()):
     * begin, run every statement, then commit. On any failure the transaction
     * is rolled back and a TransactionError is thrown, carrying the
     * per-statement errors (aligned with the batch, null where a statement
     * succeeded), the partial results and the failed statements' details.
     */
    async batch(
        queries: Array<string | { query: string; params?: QueryParams }>,
        database?: string
    ): Promise<QueryOutput[]> {
        const tx = await this.connection.beginTransaction('WRITE', database ?? this.database);

        const results: QueryOutput[] = [];
        const errors: (BatchStatementError | null)[] = [];
        const details: BatchStatementError[] = [];

        // Every statement is attempted, so the error report covers the batch
        for (const [index, entry] of queries.entries()) {
            const query = typeof entry === 'string' ? entry : entry.query;
            const params = (typeof entry === 'string' ? {} : entry.params) ?? {};

            try {
                results.push(await tx.run(query, params));
                errors.push(null);
            } catch (error) {
                const failed: BatchStatementError = { index, query, params, error };
                errors.push(failed);
                details.push(failed);
            }
        }

        if (details.length) {
            await tx.rollback().catch(() => {});

            throw new TransactionError(errors, results, details);
        }

        await tx.commit();

        return results;
    }

    /**
     * Run statements to create the schema
     */
    installSchema(): Promise<SchemaResult[]> {
        const service = new SchemaService(this.connection, this.enterprise);

        return service.create();
    }

    /**
     * Run statements to drop the schema
     */
    dropSchema(): Promise<SchemaResult[]> {
        const service = new SchemaService(this.connection, this.enterprise);

        return service.drop();
    }

    /**
     * Create a Repository
     */
    getRepository<Entity>(entity: new (...args: never[]) => Entity, database?: string): Repository<Entity> {
        return resolveRepository(this, entity, database);
    }

    async find<T>(
        constructor: new (...args: never[]) => T,
        value: string,
        database?: string
    ): Promise<T | undefined> {
        const schema = this.getSchema(constructor);

        const tx = await this.readTransaction(database);

        const service = new FindService(tx);

        const output = await service.find(constructor, schema, value);

        await tx.commit();

        return output as T | undefined;
    }

    async findById<T>(
        constructor: new (...args: never[]) => T,
        elementId: string,
        database?: string
    ): Promise<T | undefined> {
        const schema = this.getSchema(constructor);

        const tx = await this.readTransaction(database);

        const service = new FindByIdService(tx);

        const output = await service.find(constructor, schema, elementId);

        await tx.commit();

        return output as T | undefined;
    }

    async get<T>(
        constructor: new (...args: never[]) => T,
        params: Record<string, unknown>,
        limit?: number,
        skip?: number,
        database?: string
    ): Promise<T[]> {
        const schema = this.getSchema(constructor);

        const tx = await this.readTransaction(database);

        const service = new GetService(tx);

        const results = await service.get<T>(constructor, schema, params, limit, skip);

        await tx.commit();

        return results;
    }

    async getFirst<T>(
        constructor: new (...args: never[]) => T,
        params: Record<string, unknown>,
        database?: string
    ): Promise<T | undefined> {
        const records = await this.get<T>(constructor, params, 1, 0, database);

        return records[0];
    }

    async save<T>(entity: T, database?: string): Promise<T> {
        const entityRecord = entity as unknown as Record<string, unknown>;
        const schema = this.getSchema(entityRecord.constructor);

        const res = await this.inWriteTransaction(async (tx) => {
            const mergeService = new MergeService(tx.getRunner());

            const { elementId } = await mergeService.save(entity as object, schema);

            const findService = new FindByIdService(tx.getRunner());

            const hydrated = await findService.find(
                entityRecord.constructor as new (...args: never[]) => T,
                getModel(entityRecord.constructor),
                elementId
            );

            await tx.commit();

            return hydrated as T;
        }, database);

        // Emit event
        this.eventEmitter.emit(EventType.NODE_CREATED, res);

        return res;
    }

    /**
     * CREATE a new entity of the given constructor with the given properties
     * (nested relationship targets included), then hydrate the created node
     */
    async create<T>(
        constructor: new (...args: never[]) => T,
        properties: Record<string, unknown> = {},
        database?: string
    ): Promise<T> {
        const schema = this.getSchema(constructor);

        const tx = await this.writeTransaction(database);

        try {
            const entity = new constructor() as unknown as Record<string, unknown>;

            Object.assign(entity, properties);

            const createService = new CreateService(tx);

            const { elementId } = await createService.create(schema, entity);

            const findService = new FindByIdService(tx);

            const hydrated = await findService.find(constructor, schema, elementId);

            if (!hydrated) {
                throw new Error('Entity was created but could not be found immediately afterwards');
            }

            await tx.commit();

            // Emit event
            this.eventEmitter.emit(EventType.NODE_CREATED, hydrated);

            return hydrated as T;
        } catch (error) {
            await tx.rollback();

            throw error;
        }
    }

    /**
     * MERGE a node on the given match properties, then set the given
     * properties, hydrating the merged node
     */
    async mergeOn<T>(
        constructor: Newable,
        match: Record<string, unknown>,
        set: Record<string, unknown>,
        database?: string
    ): Promise<T | undefined> {
        const schema = this.getSchema(constructor);

        const tx = await this.writeTransaction(database);

        try {
            const mergeService = new MergeService(tx);

            const output = await mergeService.mergeOn(schema, match, set);

            const elementId = output.records[0].get(INTERNAL_ID) as string;

            const findService = new FindByIdService(tx);

            const hydrated = await findService.find(constructor, schema, elementId);

            await tx.commit();

            return hydrated as T | undefined;
        } catch (error) {
            await tx.rollback();

            throw error;
        }
    }

    /**
     * UPDATE the given properties on a node (`+=` semantics: provided keys
     * only, matched by the entity's primary key), then re-hydrate it
     */
    async update<T>(
        entity: T,
        properties: Record<string, unknown> = {},
        database?: string
    ): Promise<T | undefined> {
        const entityRecord = entity as unknown as Record<string, unknown>;
        const schema = this.getSchema(entityRecord.constructor);

        const tx = await this.writeTransaction(database);

        try {
            await new UpdateService(tx).update(schema, entity as object, properties);

            const idKey = schema
                .getProperties()
                .find((property) => property.getType() === PropertyType.INTERNAL_ID)
                ?.getKey();
            const elementId = idKey ? entityRecord[idKey] : undefined;

            const hydrated = elementId
                ? await new FindByIdService(tx).find(
                      entityRecord.constructor as new (...args: never[]) => T,
                      schema,
                      elementId as string
                  )
                : undefined;

            await tx.commit();

            return hydrated as T | undefined;
        } catch (error) {
            await tx.rollback();

            throw error;
        }
    }

    /**
     * Relate two saved nodes, resolving the relationship by its KEY on the
     * from-entity's schema (neode's node.relateTo(node, relationshipName)):
     * MERGE the relationship, or CREATE with `forceCreate`
     */
    async relate<From extends object, To extends object>(
        constructor: new (...args: never[]) => From,
        from: From,
        to: To,
        relationshipKey: string,
        properties: Record<string, unknown> = {},
        forceCreate = false,
        database?: string
    ): Promise<GraphRelationship | undefined> {
        const schema = this.getSchema(constructor);
        const rel = this.requireRelationship(schema, relationshipKey);

        const tx = await this.writeTransaction(database);

        try {
            const result = await new RelateService(tx).relate(
                schema,
                from,
                to,
                rel,
                properties,
                forceCreate
            );

            await tx.commit();

            if (result) {
                this.eventEmitter.emit(
                    forceCreate ? EventType.RELATIONSHIP_CREATED : EventType.RELATIONSHIP_MERGED,
                    result
                );
            }

            return result;
        } catch (error) {
            await tx.rollback();

            throw error;
        }
    }

    /**
     * Remove the relationship of the given key between two nodes and return
     * both re-hydrated
     */
    async detach<From extends object, To extends object>(
        constructor: new (...args: never[]) => From,
        from: From,
        to: To,
        relationshipKey: string,
        database?: string
    ): Promise<DetachResult<From, To>> {
        const schema = this.getSchema(constructor);
        const rel = this.requireRelationship(schema, relationshipKey);

        const tx = await this.writeTransaction(database);

        try {
            const result = await new DetachService(tx).detach(schema, from, to, rel);

            await tx.commit();

            return result;
        } catch (error) {
            await tx.rollback();

            throw error;
        }
    }

    /**
     * ALL nodes of the given constructor, optionally filtered by properties,
     * ordered, limited and skipped (neode's all())
     */
    async all<T>(
        constructor: new (...args: never[]) => T,
        params: Record<string, unknown> = {},
        order?: OrderSpec,
        limit?: number,
        skip?: number,
        database?: string
    ): Promise<T[]> {
        const schema = this.getSchema(constructor);

        const tx = await this.readTransaction(database);

        try {
            const results = await new GetService(tx).get<T>(
                constructor,
                schema,
                params,
                limit,
                skip,
                order
            );

            await tx.commit();

            return results;
        } catch (error) {
            await tx.rollback();

            throw error;
        }
    }

    /**
     * Nodes of the given constructor within `distance` of the given point,
     * ordered by distance when `order` is 'distance'
     * (neode's FindWithinDistance)
     */
    async withinDistance<T>(
        constructor: new (...args: never[]) => T,
        locationProperty: string,
        point: unknown,
        distance: number,
        params: Record<string, unknown> = {},
        order?: OrderSpec,
        limit?: number,
        skip?: number,
        database?: string
    ): Promise<T[]> {
        const schema = this.getSchema(constructor);

        const tx = await this.readTransaction(database);

        try {
            const results = await new WithinDistanceService(tx).withinDistance<T>(
                constructor,
                schema,
                locationProperty,
                point,
                distance,
                params,
                order,
                limit,
                skip
            );

            await tx.commit();

            return results;
        } catch (error) {
            await tx.rollback();

            throw error;
        }
    }

    /**
     * Define a model from a map-based schema definition (neode parity), or,
     * when no schema is given, look up a previously defined model by name.
     */
    model(name: string, schema?: SchemaDefinition): Newable {
        if ( schema ) {
            return defineModel(name, schema);
        }

        const existing = getModelByName(name);

        if ( !existing ) {
            throw new Error(unknownDefinitionError(name));
        }

        return existing;
    }

    /**
     * Define multiple models at once: { Name: schemaDefinition }
     */
    with(models: Record<string, SchemaDefinition>): this {
        Object.entries(models).forEach(([name, schema]) => this.model(name, schema));

        return this;
    }

    /**
     * Scan a directory and register each module's default export as a model
     * named after the file (neode parity, extended to .ts files)
     */
    withDirectory(directory: string): this {
        const requireModule = createRequire(__filename);

        readdirSync(directory)
            .filter((file) => [ '.js', '.ts' ].includes(extname(file).toLowerCase()))
            .forEach((file) => {
                const name = basename(file, extname(file));
                const loaded = requireModule(resolve(directory, file)) as {
                    default?: SchemaDefinition;
                };

                this.model(name, loaded.default ?? loaded as SchemaDefinition);
            });

        return this;
    }

    /**
     * neode's extend(): clone a model under a new name, adding the new name
     * as an extra label, with the given schema merged on top
     */
    extend(name: string, as: string, schema?: SchemaDefinition): Newable {
        return extendModel(name, as, schema);
    }

    /**
     * Delete a node. `options` threads the cascade modes through to the
     * delete service; the legacy form `delete(entity, database)` — a string
     * second argument, as accepted by INeode — is kept working.
     */
    async delete<T>(entity: T, options?: DeleteOptions | string, database?: string): Promise<void> {
        const schema = this.getSchema((entity as unknown as Record<string, unknown>).constructor);

        const tx = await this.writeTransaction(typeof options === 'string' ? options : database);

        const service = new DeleteService(tx);

        await service.delete(
            schema,
            entity as object,
            typeof options === 'string' ? undefined : options
        );

        await tx.commit();

        // Emit event
        this.eventEmitter.emit(EventType.NODE_DELETED, entity);
    }
}
