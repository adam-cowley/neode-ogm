import Builder from "@neode/querybuilder";
import { QueryResult,  Transaction } from "neo4j-driver";
import { THIS_NODE } from "../constants";
import EntitySchema from "../meta/entity/entity-schema";
import { hydrateNode,
    // EagerNode, EagerRelationship
} from "../utils";

export default class QueryService {
    constructor(protected readonly transaction: Transaction) {}

    async returnFirst<T>(constructor: ObjectConstructor, schema: EntitySchema, builder: Builder<any>): Promise<T | undefined> {
        const results = await this.return(constructor, schema, builder, 0, 1)

        return results[0]
    }

    async return(constructor: ObjectConstructor, schema: EntitySchema, builder: Builder<any>, skip?: number, limit?: number): Promise<any[]> {
        // Return
        builder.return(THIS_NODE)

        // Eager Loading
        schema.getRelationships()
            .forEach((rel) => {
                const key = rel.getKey()
                // TODO: Check type - is this a node entity or a relationship entity?
                // const targetEntity = rel.getTarget()

                // TODO: Inner Eager statements inside `other: { node: other, eager: { [relKey] : { rel, start, end, other }} }`
                if ( rel.getEager() ) {
                    builder.return(`[ (${THIS_NODE})${rel.toString(key)}(other) | {
                        rel: ${key},
                        start: { node: startNode(${key}) },
                        end: { node: endNode(${key}) },
                        other: { node: other, eager: {} }
                    }] AS ${key}`)
                }
            })

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
        return this.getAndHydrate(res, constructor, schema)
    }

    private getAndHydrate(res: QueryResult, constructor: ObjectConstructor, schema: EntitySchema) {
        return res.records.map(row => {
            const node = row.get(THIS_NODE);
            const eager = Object.fromEntries(row.keys.filter(key => key !== THIS_NODE)
                .map(key => [ key, row.get(key) ]))

            return hydrateNode(schema, constructor, node, eager)
        })
    }

}
