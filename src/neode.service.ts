import neo4j, { Driver, Session, Transaction } from "neo4j-driver";
import { models } from "./meta";
import Schema from "./meta/schema";
import { EventEmitter } from 'events';
import FindService from "./services/find.service";
import MergeService from "./services/merge.service";
import { INTERNAL_NODE, THIS_NODE } from "./constants";
import { EventType } from "./common/events";
import DeleteService from "./services/delete.service";

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

    private getSchema(constructor: any): Schema {
        if ( !models.has(constructor) ) {
            throw new Error(`Couldn't find a model for "${constructor.name}".  Registered model(s) are: ${ Array.from( models.keys() ).map(model => (model as Record<string, any>).name)}`)
        }

        return models.get(constructor)
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


    async find<T extends Object>(constructor: any, value: string, database?: string): Promise<T | undefined> {
        try {
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
        catch(e) {
            return Promise.reject(e)
        }
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

            return entity
        }
        catch(e) {
            return Promise.reject(e)
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
            return Promise.reject(e)
        }

    }
}