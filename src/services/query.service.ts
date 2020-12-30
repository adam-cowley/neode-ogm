import Builder from "@neode/querybuilder";
import { QueryResult,  Transaction } from "neo4j-driver";
import { THIS_NODE } from "../constants";
import Schema from "../meta/schema";

export default class QueryService {
    constructor(protected readonly transaction: Transaction) {}

    async returnFirst(constructor: Function, schema: Schema, builder: Builder<any>): Promise<any | undefined> {
        // TODO: Eager Loading
        builder.return(THIS_NODE)
            .limit(1)

        // Build Cypher
        const { cypher, params } = builder.build()

        const res = await this.transaction.run(cypher, params)

        if ( res.records.length === 0 ) {
            return undefined
        }

        // Hydrate
        const nodes = this.getAndHydrate(res, constructor, schema)

        return nodes[0]
    }

    async return(constructor: Function, schema: Schema, builder: Builder<any>, skip?: number, limit?: number): Promise<any[]> {
        // TODO: Eager Loading
        builder.return(THIS_NODE)

        // Skip and limit
        if ( skip ) builder.skip(skip)
        if ( limit ) builder.limit(limit)

        // Build Cypher
        const { cypher, params } = builder.build()

        const res = await this.transaction.run(cypher, params)

        if ( res.records.length === 0 ) {
            return []
        }

        // Hydrate
        const nodes = this.getAndHydrate(res, constructor, schema)

        return nodes[0]
    }

    private getAndHydrate(res: QueryResult, constructor: Function, schema: Schema) {
        return res.records.map(row => {
            const node = row.get(THIS_NODE);
            // @ts-ignore
            const object = new constructor()

            schema.getProperties()
                .filter(property => node.properties.hasOwnProperty(property.getKey()))
                .map(property => {
                    // TODO: Complex types
                    // TODO: Convert neo4j types back into native types
                    object[ property.getKey() ] = node.properties[ property.getKey() ]
                })

            return object
        })
    }

}