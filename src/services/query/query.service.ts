import { Newable } from "../../meta/newable";
import Builder from '../../query';
import { Runner } from '../../driver/types';
import { GraphNode } from '../../driver/types';
import { EagerRelationship, hydrateNode } from '../../utils';
import { THIS_NODE } from '../../constants';
import EntitySchema from '../../meta/entity/entity-schema';

export default class QueryService {
    constructor(protected readonly runner: Runner) {}

    async returnFirst<T>(
        constructor: Newable,
        schema: EntitySchema,
        builder: Builder
    ): Promise<T | undefined> {
        const results = await this.return<T>(constructor, schema, builder, 0, 1);

        return results[0];
    }

    async return<T>(
        constructor: Newable,
        schema: EntitySchema,
        builder: Builder,
        skip?: number,
        limit?: number
    ): Promise<T[]> {
        // Return
        builder.return(THIS_NODE);

        // Eager Loading
        schema.getRelationships().forEach((rel) => {
            const key = rel.getKey();

            // TODO: Nested eager statements inside `other: { eager: { ... } }`
            if (rel.getEager()) {
                builder.return(
                    `[ (${THIS_NODE})${rel.toString(key)}(other) | {
                        rel: ${key},
                        start: { node: startNode(${key}) },
                        end: { node: endNode(${key}) },
                        other: { node: other }
                    }] AS ${key}`
                );
            }
        });

        // Skip and limit
        if (skip) builder.skip(skip);
        if (limit) builder.limit(limit);

        // Build Cypher
        const { query, params } = builder.build();

        const res = await this.runner.run(query, params);

        if (res.records.length === 0) {
            return [];
        }

        // Hydrate
        return this.getAndHydrate(res, constructor, schema);
    }

    private getAndHydrate<T>(
        res: { records: { get(key: string): unknown; keys: string[] }[] },
        constructor: Newable,
        schema: EntitySchema
    ): Promise<T[]> {
        return Promise.all(
            res.records.map(async (row) => {
                const node = row.get(THIS_NODE) as GraphNode;
                const eager = Object.fromEntries(
                    row.keys
                        .filter((key) => key !== THIS_NODE)
                        .map((key) => [key, row.get(key)])
                ) as Record<string, EagerRelationship[]>;

                return hydrateNode<T>(schema, constructor, node, eager);
            })
        );
    }
}
