import Builder from '../query';
import { THIS_NODE } from '../constants';
import { Runner } from '../driver/types';
import EntitySchema from '../meta/entity/entity-schema';
import { Newable } from '../meta/newable';
import { OrderSpec, applyOrder } from '../services/query/get.service';
import { projectionNode } from './projection';
import { hydrateProjection } from './hydrate';

/**
 * Read service for models with projected properties (NTS-135/136/137/138):
 * the same match / where surface as the plain query services, but the
 * RETURN map projection carries every projected value — related subsets,
 * counts, exists, label predicates, expressions — in one query per read.
 */
export default class ProjectionService {
    constructor(private readonly runner: Runner) {}

    /** All nodes matching the given property map (GetService parity) */
    async get<T>(
        constructor: Newable,
        schema: EntitySchema,
        params: Record<string, unknown> = {},
        limit?: number,
        skip?: number,
        order?: OrderSpec
    ): Promise<T[]> {
        const builder = new Builder();

        builder.match(THIS_NODE, schema.getLabels());

        schema.getProperties().forEach((property) => {
            const key = property.getKey();

            if (Object.hasOwn(params, key)) {
                builder.where(`${THIS_NODE}.${key}`, params[key]);
            }
        });

        applyOrder(builder, order);

        return this.run<T>(constructor, schema, builder, limit, skip);
    }

    /** One node by primary key value (FindService parity) */
    async find<T>(
        constructor: Newable,
        schema: EntitySchema,
        value: unknown
    ): Promise<T | undefined> {
        const builder = new Builder();

        const primaryKey = schema.getPrimaryKey()!.getKey();

        builder.match(THIS_NODE, schema.getLabels(), { [primaryKey]: value });

        return (await this.run<T>(constructor, schema, builder, 1))[0];
    }

    /** One node by element ID (FindByIdService parity) */
    async findById<T>(
        constructor: Newable,
        schema: EntitySchema,
        elementId: string
    ): Promise<T | undefined> {
        const builder = new Builder();

        builder.match(THIS_NODE).whereId(THIS_NODE, elementId);

        return (await this.run<T>(constructor, schema, builder, 1))[0];
    }

    private async run<T>(
        constructor: Newable,
        schema: EntitySchema,
        builder: Builder,
        limit?: number,
        skip?: number
    ): Promise<T[]> {
        builder.return(`${projectionNode(THIS_NODE, schema)} AS ${THIS_NODE}`);

        if (skip) builder.skip(skip);
        if (limit) builder.limit(limit);

        const { query, params } = builder.build();

        const res = await this.runner.run(query, params);

        return res.records.map((row) =>
            hydrateProjection<T>(schema, constructor, row.get(THIS_NODE) as Record<string, unknown>)
        );
    }
}
