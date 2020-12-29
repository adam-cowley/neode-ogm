import neo4j, { Driver, ResultSummary } from "neo4j-driver";
import { models } from "./meta";
import FindService from "./services/find";
import MergeService from "./services/merge";
import { TransactionManager } from "./transaction/manager";

export class Neode {

    transactionManager: TransactionManager;
    driver: Driver;

    constructor() {
        this.driver = neo4j.driver('neo4j://localhost:7687', neo4j.auth.basic('neo4j', 'neo'))
        this.transactionManager = new TransactionManager(this.driver)
    }

    getDriver(): Driver {
        return this.driver
    }

    async find(constructor: any, value: string, database?: string): Promise<any | undefined> {
        if ( !models.has(constructor) ) {
            throw new Error(`Couldn't find a model for "${constructor.name}".  Registered model(s) are: ${ Array.from( models.keys() ).map(model => model.name)}`)
        }

        // Get Schema
        const schema = models.get(constructor)

        // Open Tx
        const tx = this.transactionManager.open(database)

        const service = new FindService(tx)

        const output = await service.find(constructor, schema, value)

        // await tx.commit()

        return output
    }

    async save(model: Object, database?: string): Promise<ResultSummary> {
        if ( !models.has(model.constructor) ) {
            throw new Error(`Couldn't find a model for "${model.constructor.name}".  Registered model(s) are: ${ Array.from( models.keys() ).map(model => model.name)}`)
        }

        // Get Schema
        const schema = models.get(model.constructor)

        // Open Tx
        const tx = this.transactionManager.open(database)

        const merge = new MergeService(tx)

        const res = await merge.save(model, schema)

        return res.summary
    }
}