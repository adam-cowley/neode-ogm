import { EventEmitter } from 'events';
import { GraphRelationship, QueryOutput, QueryParams, Runner, TransactionHandle } from '../driver/types';
import { EventType } from '../common/events';
import { getModel, getModels } from '../meta';
import EntitySchema from '../meta/entity/entity-schema';
import { PropertyType } from '../meta/property-schema';
import RelationshipPropertySchema from '../meta/relationship-property-schema';
import INeode from '../neode.interface';
import DeleteService, { DeleteOptions } from '../services/query/delete.service';
import DetachService, { DetachResult } from '../services/query/detach.service';
import FindByIdService from '../services/query/find-by-id.service';
import FindService from '../services/query/find.service';
import GetService, { OrderSpec } from '../services/query/get.service';
import MergeService from '../services/query/merge.service';
import RelateService from '../services/query/relate.service';
import UpdateService from '../services/query/update.service';
import WithinDistanceService from '../services/query/within-distance.service';

export default class TransactionalService implements INeode {
    constructor(
        private readonly handle: TransactionHandle,
        private readonly eventEmitter: EventEmitter
    ) {}

    /**
     * The underlying transaction handle — a Runner scoped to this transaction
     */
    getRunner(): Runner {
        return this.handle;
    }

    getTransaction(): TransactionHandle {
        return this.handle;
    }

    async commit(): Promise<void> {
        await this.handle.commit();
    }

    async rollback(): Promise<void> {
        await this.handle.rollback();
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
     * (mirror of the facade's relate-by-key resolution)
     */
    private requireRelationship(schema: EntitySchema, key: string): RelationshipPropertySchema {
        if (!schema.hasRelationship(key)) {
            throw new Error(
                `Unknown relationship "${key}" on ${schema.getLabels().join(':') || 'entity'}`
            );
        }

        return schema.getRelationship(key);
    }

    async find<T>(
        constructor: new (...args: never[]) => T,
        value: string,
        _database?: string
    ): Promise<T | undefined> {
        const schema = this.getSchema(constructor);

        const service = new FindService(this.handle);

        return service.find(constructor, schema, value) as Promise<T | undefined>;
    }

    async findById<T>(
        constructor: new (...args: never[]) => T,
        id: string,
        _database?: string
    ): Promise<T | undefined> {
        const schema = this.getSchema(constructor);

        const service = new FindByIdService(this.handle);

        return service.find(constructor, schema, id) as Promise<T | undefined>;
    }

    async get<T>(
        constructor: new (...args: never[]) => T,
        params: Record<string, unknown>,
        limit?: number,
        skip?: number,
        _database?: string
    ): Promise<T[]> {
        const schema = this.getSchema(constructor);

        const service = new GetService(this.handle);

        return service.get<T>(constructor, schema, params, limit, skip);
    }

    async getFirst<T>(
        constructor: new (...args: never[]) => T,
        params: Record<string, unknown>,
        database?: string
    ): Promise<T | undefined> {
        const records = await this.get<T>(constructor, params, 1, 0, database);

        return records[0];
    }

    async save<T>(entity: T, _database?: string): Promise<T> {
        const entityRecord = entity as unknown as Record<string, unknown>;
        const schema = this.getSchema(entityRecord.constructor);

        const merge = new MergeService(this.handle);

        const { elementId } = await merge.save(entity as object, schema);

        const saved = await this.findById<T>(
            entityRecord.constructor as new (...args: never[]) => T,
            elementId
        );

        if (!saved) {
            throw new Error('Entity was saved but could not be found immediately afterwards');
        }

        // Emit event
        this.eventEmitter.emit(EventType.NODE_CREATED, saved);

        return saved;
    }

    /**
     * Delete a node in this transaction's scope. `options` threads the
     * cascade modes through; the legacy string second argument (database)
     * stays accepted, as on the facade.
     */
    async delete<T>(entity: T, options?: DeleteOptions | string, _database?: string): Promise<void> {
        const schema = this.getSchema((entity as unknown as Record<string, unknown>).constructor);

        const service = new DeleteService(this.handle);

        await service.delete(
            schema,
            entity as object,
            typeof options === 'string' ? undefined : options
        );

        // Emit event
        this.eventEmitter.emit(EventType.NODE_DELETED, entity);
    }

    /**
     * UPDATE the given properties on a node (`+=` semantics), then
     * re-hydrate it — mirror of the facade's update
     */
    async update<T>(
        entity: T,
        properties: Record<string, unknown> = {},
        _database?: string
    ): Promise<T | undefined> {
        const entityRecord = entity as unknown as Record<string, unknown>;
        const schema = this.getSchema(entityRecord.constructor);

        await new UpdateService(this.handle).update(schema, entity as object, properties);

        const idKey = schema
            .getProperties()
            .find((property) => property.getType() === PropertyType.INTERNAL_ID)
            ?.getKey();
        const elementId = idKey ? entityRecord[idKey] : undefined;

        if (!elementId) {
            return undefined;
        }

        return new FindByIdService(this.handle).find(
            entityRecord.constructor as new (...args: never[]) => T,
            schema,
            elementId as string
        ) as Promise<T | undefined>;
    }

    /**
     * Relate two saved nodes by the relationship's KEY on the from-entity's
     * schema — mirror of the facade's relate
     */
    async relate<From extends object, To extends object>(
        constructor: new (...args: never[]) => From,
        from: From,
        to: To,
        relationshipKey: string,
        properties: Record<string, unknown> = {},
        forceCreate = false
    ): Promise<GraphRelationship | undefined> {
        const schema = this.getSchema(constructor);
        const rel = this.requireRelationship(schema, relationshipKey);

        const result = await new RelateService(this.handle).relate(
            schema,
            from,
            to,
            rel,
            properties,
            forceCreate
        );

        if (result) {
            this.eventEmitter.emit(
                forceCreate ? EventType.RELATIONSHIP_CREATED : EventType.RELATIONSHIP_MERGED,
                result
            );
        }

        return result;
    }

    /**
     * Remove the relationship of the given key between two nodes and return
     * both re-hydrated — mirror of the facade's detach
     */
    async detach<From extends object, To extends object>(
        constructor: new (...args: never[]) => From,
        from: From,
        to: To,
        relationshipKey: string
    ): Promise<DetachResult<From, To>> {
        const schema = this.getSchema(constructor);
        const rel = this.requireRelationship(schema, relationshipKey);

        return new DetachService(this.handle).detach(schema, from, to, rel);
    }

    /**
     * ALL nodes of the given constructor, optionally filtered, ordered,
     * limited and skipped — mirror of the facade's all
     */
    async all<T>(
        constructor: new (...args: never[]) => T,
        params: Record<string, unknown> = {},
        order?: OrderSpec,
        limit?: number,
        skip?: number,
        _database?: string
    ): Promise<T[]> {
        const schema = this.getSchema(constructor);

        return new GetService(this.handle).get<T>(constructor, schema, params, limit, skip, order);
    }

    /**
     * Nodes of the given constructor within `distance` of the given point —
     * mirror of the facade's withinDistance
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
        _database?: string
    ): Promise<T[]> {
        const schema = this.getSchema(constructor);

        return new WithinDistanceService(this.handle).withinDistance<T>(
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
    }

    /**
     * Run a query in this transaction's scope
     */
    async readCypher(query: string, params: QueryParams = {}): Promise<QueryOutput> {
        return this.handle.run(query, params);
    }

    async writeCypher(query: string, params: QueryParams = {}): Promise<QueryOutput> {
        return this.handle.run(query, params);
    }
}
