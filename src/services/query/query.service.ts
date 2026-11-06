import { Newable } from "../../meta/newable";
import Builder from '../../query';
import { Runner } from '../../driver/types';
import { GraphNode } from '../../driver/types';
import { hydrateNode } from '../../utils';
import { THIS_NODE } from '../../constants';
import { eagerNode } from '../../query/eager-utils';
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
        // Eager Loading: when the schema declares eager relationships the
        // root node is returned as a map projection nesting an eager pattern
        // comprehension per relationship, up to MAX_EAGER_DEPTH degrees deep
        if (schema.getRelationships().some((rel) => rel.getEager())) {
            builder.return(`${eagerNode(1, THIS_NODE, schema)} AS ${THIS_NODE}`);
        } else {
            builder.return(THIS_NODE);
        }

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
            res.records.map(async (row) =>
                // With eager relationships the root column is a projection
                // map carrying its own eager values, without them a plain node
                hydrateNode<T>(schema, constructor, row.get(THIS_NODE) as GraphNode)
            )
        );
    }
}
