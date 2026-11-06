import { EventEmitter } from 'events';
import { QueryOutput, QueryParams, Runner, TransactionHandle } from '../driver/types';
import { EventType } from '../common/events';
import { getModel, getModels } from '../meta';
import EntitySchema from '../meta/entity/entity-schema';
import INeode from '../neode.interface';
import DeleteService from '../services/query/delete.service';
import FindByIdService from '../services/query/find-by-id.service';
import FindService from '../services/query/find.service';
import GetService from '../services/query/get.service';
import MergeService from '../services/query/merge.service';

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

    async delete<T>(entity: T, _database?: string): Promise<void> {
        const schema = this.getSchema((entity as unknown as Record<string, unknown>).constructor);

        const service = new DeleteService(this.handle);

        await service.delete(schema, entity as object);

        // Emit event
        this.eventEmitter.emit(EventType.NODE_DELETED, entity);
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
