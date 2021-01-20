import { EventEmitter } from 'events';
import { QueryResult, Session, Transaction } from "neo4j-driver";
import { Repository } from '..';
import { EventType } from '../common/events';
import { getModel, getModels } from "../meta";
import EntitySchema from "../meta/entity/entity-schema";
import INeode from '../neode.interface';
import DeleteService from '../services/query/delete.service';
import FindByIdService from '../services/query/find-by-id.service';
import FindService from "../services/query/find.service";
import GetService from "../services/query/get.service";
import MergeService from "../services/query/merge.service";

export default class TransactionalService implements INeode {

    constructor(
        private readonly session: Session,
        private readonly transaction: Transaction,
        private readonly eventEmitter: EventEmitter
    ) {}

    getTransaction() {
        return this.transaction
    }

    private getSchema(constructor: any): EntitySchema {
        if ( !getModel(constructor) ) {
            throw new Error(`Couldn't find a model for "${constructor.name}".  Registered model(s) are: ${ Array.from( getModels().keys() ).map(model => (model as Record<string, any>).name)}`)
        }

        return getModel(constructor)
    }

    async find<T extends Object>(constructor: any, value: string, database?: string): Promise<T | undefined> {
        // Get Schema
        const schema = this.getSchema(constructor)

        // Find Node
        const service = new FindService(this.transaction)

        return service.find(constructor, schema, value)
    }

    async findById<T extends Object>(constructor: any, id: number, database?: string): Promise<T | undefined> {
        // Get Schema
        const schema = this.getSchema(constructor)

        // Find Node
        const service = new FindByIdService(this.transaction)

        return service.find(constructor, schema, id)
    }

    async get<T extends Object>(constructor: any, params: Record<string, any>, limit?: number, skip?: number, database?: string): Promise<T[]> {
        // Get Schema
        const schema = this.getSchema(constructor)

        const service = new GetService(this.transaction)

        const results = await service.get<T>(constructor, schema, params, limit, skip)

        return results;
    }

    async getFirst<T>(constructor: any, params: Record<string, any>, database?: string): Promise<T | undefined> {
        const records = await this.get<T>(constructor, params, 1, 0, database)

        return records[0]
    }

    async save<T extends Object>(entity: T, database?: string): Promise<T> {
        try {
            // Get Schema
            const schema = this.getSchema(entity.constructor)

            const merge = new MergeService(this.transaction)

            await merge.save(entity, schema)

            const id = entity[ schema.getPrimaryKey().getKey() ]

            const saved = await this.find<T>(entity.constructor, id)

            // Emit event
            this.eventEmitter.emit(EventType.NODE_CREATED, saved)

            return saved
        }
        catch (e) {
            throw e
        }
    }

    async delete<T extends Object>(entity: T, database?: string): Promise<void> {
        try {
            const schema = this.getSchema(entity.constructor)

            const service = new DeleteService(this.transaction)

            await service.delete(schema, entity)

            // Emit event
            this.eventEmitter.emit(EventType.NODE_DELETED, entity)
        }
        catch(e) {
            throw e
        }
    }

    /**
     * Create a Repository
     *
     * @param {Object} entity
     * @param {String} database
     * @return {Repository<T>}
     */
    getRepository<T>(entity: T, database?: string): Repository<T> {
        return new Repository<T>(this, entity, database)
    }


    /**
     * Run a read query against the database in an auto-commit transaction
     * and return the QueryResult directly from the neo4j driver
     *
     * @param {String} query
     * @param {Record<string, any>} params
     * @param database
     */
    readCypher(query: string, params: Record<string, any> = {}): Promise<QueryResult> {
        return this.transaction.run(query, params)
    }

    /**
     * Run a write query against the database in an auto-commit transaction
     * and return the QueryResult directly from the neo4j driver
     *
     * @param {String} query
     * @param {Record<string, any>} params
     * @param database
     */
    writeCypher(query: string, params: Record<string, any> = {}): Promise<QueryResult> {
        // TODO: Throw error if this is not a write transaction
        return this.transaction.run(query, params)
    }


    async commit(): Promise<void> {
        await this.transaction.commit()
        await this.session.close()
    }

    async rollback(): Promise<void> {
        await this.transaction.rollback()
        await this.session.close()
    }
}