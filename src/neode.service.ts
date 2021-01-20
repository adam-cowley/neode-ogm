import neo4j, { Driver, QueryResult, Session, Transaction } from "neo4j-driver";
import { getModel, getModels } from "./meta";
import EntitySchema from "./meta/entity/entity-schema";
import { EventEmitter } from 'events';
import FindService from "./services/query/find.service";
import MergeService from "./services/query/merge.service";
import { INTERNAL_ID } from "./constants";
import { EventType } from "./common/events";
import DeleteService from "./services/query/delete.service";
import INeode from "./neode.interface";
import GetService from "./services/query/get.service";
import SchemaService, { SchemaResult } from "./services/schema/schema.service";
import { Repository } from ".";
import TransactionalService from "./transaction/transactional.service";
import FindByIdService from "./services/query/find-by-id.service";

export default class Neode implements INeode {

    private driver: Driver;
    private eventEmitter: EventEmitter = new EventEmitter();
    private database: string;
    private enterprise: boolean;

    constructor(driver: Driver, database?: string, enterprise: boolean = false) {
        this.driver = driver
        this.database = database
        this.enterprise = enterprise
    }

    getDriver(): Driver {
        return this.driver
    }

    isEnterprise(): boolean {
        return this.enterprise
    }

    private getSchema(constructor: any): EntitySchema {
        if ( !getModel(constructor) ) {
            throw new Error(`Couldn't find a model for "${constructor.name}".  Registered model(s) are: ${ Array.from( getModels().keys() ).map(model => (model as Record<string, any>).name)}`)
        }

        return getModel(constructor)
    }

    /**
     * @deprecated
     * Create a new Session in the Neo4j Driver.
     *
     * @param {String} database
     * @return {Session}
     */
    session(database: string = this.database): Session {
        console.warn('neode.session() is deprecated - use .readSession() or .writeSession() instead')
        return this.readSession(database);
    }

    /**
     * Create an explicit Read Session
     *
     * @param {String} database
     * @return {Session}
     */
    readSession(database: string = this.database): Session {
        return this.driver.session({
            database,
            defaultAccessMode: neo4j.session.READ,
        });
    }

    /**
     * Create an explicit Write Session
     *
     * @param {String} database
     * @return {Session}
     */
    writeSession(database: string = this.database): Session {
        return this.driver.session({
            database,
            defaultAccessMode: neo4j.session.WRITE,
        });
    }

    /**
     * Run a read query against the database in an auto-commit transaction
     * and return the QueryResult directly from the neo4j driver
     *
     * @param {String} query
     * @param {Record<string, any>} params
     * @param database
     */
    readCypher(query: string, params: Record<string, any> = {}, database?: string): Promise<QueryResult> {
        const session = this.readSession(database)

        return session.run(query, params)
            .then(res => {
                session.close()

                return res
            })
    }

    /**
     * Run a write query against the database in an auto-commit transaction
     * and return the QueryResult directly from the neo4j driver
     *
     * @param {String} query
     * @param {Record<string, any>} params
     * @param database
     */
    writeCypher(query: string, params: Record<string, any> = {}, database?: string): Promise<QueryResult> {
        const session = this.writeSession(database)

        return session.run(query, params)
            .then(res => {
                session.close()

                return res
            })
    }

    /**
     * Begin a Read Transaction
     *
     * @param {String} database
     * @return {Transaction}
     */
    readTransaction(database: string = this.database): Transaction {
        const session = this.readSession(database)

        return session.beginTransaction()
    }

    /**
     * Begin a Write Transaction
     *
     * @param {String} database
     * @return {Transaction}
     */
    writeTransaction(database: string = this.database): Transaction {
        const session = this.writeSession(database)

        return session.beginTransaction()
    }

    /**
     * Open a new transaction and return a TransactionalService
     * (Remember to call .commit())
     *
     * @param database
     */
    openReadTransaction(database?: string): TransactionalService {
        const session = this.readSession(database)
        const transaction = session.beginTransaction()

        return new TransactionalService(session, transaction, this.eventEmitter)
    }

    /**
     * Open a new transaction and return a TransactionalService
     * (Remember to call .commit())
     *
     * @param database
     */
    openWriteTransaction(database?: string): TransactionalService {
        const session = this.writeSession(database)
        const transaction = session.beginTransaction()

        return new TransactionalService(session, transaction, this.eventEmitter)
    }

    /**
     * Run a unit of work within a READ transaction (Remember to call .commit())
     *
     * @param work
     * @param database
     */
    inReadTransaction(work: (tx: TransactionalService) => any, database?: string): Promise<any> {
        const tx = this.openReadTransaction(database)

        return work(tx)
    }

    /**
     * Run a unit of work within a WRITE transaction (Remember to call .commit())
     *
     * @param work
     * @param database
     */
    inWriteTransaction(work: (tx: TransactionalService) => any, database?: string): Promise<any> {
        const tx = this.openWriteTransaction(database)

        return work(tx)
    }

    /**
     * Run statements to create the schema
     */
    installSchema(): Promise<SchemaResult[]> {
        const service = new SchemaService(this.driver)

        return service.create()
    }

    /**
     * Run statements to drop the schema
     */
    dropSchema(): Promise<SchemaResult[]> {
        const service = new SchemaService(this.driver)

        return service.drop()
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


    async find<T extends Object>(constructor: any, value: string, database?: string): Promise<T | undefined> {
        // Get Schema
        const schema = this.getSchema(constructor)

        // Open Tx
        const tx = this.readTransaction(database)

        const service = new FindService(tx)

        const output = await service.find(constructor, schema, value)

        // Commit
        await tx.commit()

        return output
    }

    async findById<T extends Object>(constructor: any, id: number, database?: string): Promise<T | undefined> {
        // Get Schema
        const schema = this.getSchema(constructor)

        // Open Tx
        const tx = this.readTransaction(database)

        const service = new FindByIdService(tx)

        const output = await service.find(constructor, schema, id)

        // Commit
        await tx.commit()

        return output
    }

    async get<T extends Object>(constructor: any, params: Record<string, any>, limit?: number, skip?: number, database?: string): Promise<T[]> {
        // Get Schema
        const schema = this.getSchema(constructor)

        // Open Tx
        const tx = this.readTransaction(database)

        const service = new GetService(tx)

        const results = await service.get<T>(constructor, schema, params, limit, skip)

        // Commit the transaction and clear it from memory
        await tx.commit()

        return results
    }

    async getFirst<T>(constructor: any, params: Record<string, any>, database?: string): Promise<T | undefined> {
        const records = await this.get<T>(constructor, params, 1, 0, database)

        return records[0]
    }


    async save<T extends Object>(entity: T, database?: string): Promise<T> {
        try {
            // Get Schema
            const schema = this.getSchema(entity.constructor)

            // Open Tx
            const res = await this.inWriteTransaction(async tx => {
                const mergeService = new MergeService(tx.getTransaction())

                const res = await mergeService.save(entity, schema)

                const internalId = res.records[0].get(INTERNAL_ID).toNumber()

                const findService = new FindByIdService(tx.getTransaction())

                const hydrated = await findService.find(entity.constructor, getModel(entity.constructor), internalId)

                await tx.commit()

                return hydrated
            })

            // Emit event
            this.eventEmitter.emit(EventType.NODE_CREATED, res)

            return res
        }
        catch (e) {
            throw e
        }
    }

    async delete<T extends Object>(entity: T, database?: string): Promise<void> {
        try {
            const schema = this.getSchema(entity.constructor)

            // Open Tx
            const tx = this.writeTransaction(database)

            const service = new DeleteService(tx)

            await service.delete(schema, entity)

            // Emit event
            this.eventEmitter.emit(EventType.NODE_DELETED, entity)
        }
        catch(e) {
            throw e
        }

    }
}