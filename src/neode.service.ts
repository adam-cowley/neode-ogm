import { EventEmitter } from 'events';
import {
    ConnectionProvider,
    QueryOutput,
    QueryParams,
    Runner,
    TransactionHandle,
} from './driver/types';
import { Neo4jConnectionProvider } from './driver/neo4j';
import { RelateConnectionProvider } from './driver/relate';
import { getModel, getModels } from './meta';
import EntitySchema from './meta/entity/entity-schema';
import { EventType } from './common/events';
import FindService from './services/query/find.service';
import MergeService from './services/query/merge.service';
import DeleteService from './services/query/delete.service';
import INeode from './neode.interface';
import GetService from './services/query/get.service';
import SchemaService, { SchemaResult } from './services/schema/schema.service';
import { Repository } from '.';
import TransactionalService from './transaction/transactional.service';
import FindByIdService from './services/query/find-by-id.service';

export default class Neode implements INeode {
    private eventEmitter: EventEmitter = new EventEmitter();

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
     * Run a single statement in an implicit transaction
     */
    readCypher(query: string, params: QueryParams = {}, _database?: string): Promise<QueryOutput> {
        return this.connection.run(query, params, 'READ');
    }

    writeCypher(query: string, params: QueryParams = {}, _database?: string): Promise<QueryOutput> {
        return this.connection.run(query, params, 'WRITE');
    }

    /**
     * Open an explicit READ transaction
     */
    async readTransaction(_database?: string): Promise<TransactionHandle> {
        return this.connection.beginTransaction('READ');
    }

    /**
     * Open an explicit WRITE transaction
     */
    async writeTransaction(_database?: string): Promise<TransactionHandle> {
        return this.connection.beginTransaction('WRITE');
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

        return work(tx);
    }

    /**
     * Run a unit of work within a WRITE transaction
     */
    async inWriteTransaction<T>(
        work: (tx: TransactionalService) => Promise<T>,
        database?: string
    ): Promise<T> {
        const tx = await this.openWriteTransaction(database);

        return work(tx);
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
        return new Repository<Entity>(this, entity, database);
    }

    async find<T>(
        constructor: new (...args: never[]) => T,
        value: string,
        _database?: string
    ): Promise<T | undefined> {
        const schema = this.getSchema(constructor);

        const tx = await this.readTransaction(_database);

        const service = new FindService(tx);

        const output = await service.find(constructor, schema, value);

        await tx.commit();

        return output as T | undefined;
    }

    async findById<T>(
        constructor: new (...args: never[]) => T,
        elementId: string,
        _database?: string
    ): Promise<T | undefined> {
        const schema = this.getSchema(constructor);

        const tx = await this.readTransaction(_database);

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

    async delete<T>(entity: T, database?: string): Promise<void> {
        const schema = this.getSchema((entity as unknown as Record<string, unknown>).constructor);

        const tx = await this.writeTransaction(database);

        const service = new DeleteService(tx);

        await service.delete(schema, entity as object);

        await tx.commit();

        // Emit event
        this.eventEmitter.emit(EventType.NODE_DELETED, entity);
    }
}
