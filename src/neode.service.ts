import neo4j, { Driver, QueryResult, Session, Transaction } from "neo4j-driver";
import { getModel, getModels } from "./meta";
import EntitySchema from "./meta/entity/entity-schema";
import { EventEmitter } from 'events';
import FindService from "./services/query/find.service";
import MergeService from "./services/query/merge.service";
import { INTERNAL_NODE, THIS_NODE } from "./constants";
import { EventType } from "./common/events";
import DeleteService from "./services/query/delete.service";
import INeode from "./neode.interface";
import GetService from "./services/query/get.service";
import SchemaService from "./services/schema/schema.service";

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
     * Run statements to create the schema
     */
    installSchema(): Promise<void> {
        const service = new SchemaService(this.driver)

        return service.create()
    }

    /**
     * Run statements to drop the schema
     */
    dropSchema(): Promise<void> {
        const service = new SchemaService(this.driver)

        return service.drop()
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
            const tx = this.writeTransaction(database)

            const merge = new MergeService(tx)

            const res = await merge.save(entity, schema)

            // TODO: Should this happen here?!
            const node = res.records[0].get(THIS_NODE)

            entity[ INTERNAL_NODE ] = node


            // Commit the transaction and clear it from memory
            await tx.commit()

            // Emit event
            this.eventEmitter.emit(EventType.NODE_CREATED, entity)

            const id = entity[ schema.getPrimaryKey().getKey() ]

            return this.find(entity.constructor, id)
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