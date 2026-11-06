import Builder from '../../query';
import { getModel } from '../../meta';
import EntitySchema from '../../meta/entity/entity-schema';
import { Newable } from '../../meta/newable';
import { PropertyType } from '../../meta/property-schema';
import RelationshipPropertySchema from '../../meta/relationship-property-schema';
import { matchCriteriaForEntity } from '../../utils';
import FindByIdService from './find-by-id.service';
import QueryService from './query.service';

export interface DetachResult<From, To> {
    from: From | undefined;
    to: To | undefined;
}

export default class DetachService extends QueryService {
    /**
     * Remove the relationship(s) of the given type between two nodes
     * (neode DetachFrom.js, narrowed to the relationship type and
     * direction declared on the schema) and return both re-hydrated nodes.
     */
    async detach<From extends object, To extends object>(
        schema: EntitySchema,
        fromEntity: From,
        toEntity: To,
        rel: RelationshipPropertySchema
    ): Promise<DetachResult<From, To>> {
        const fromAlias = 'from';
        const toAlias = 'to';
        const relAlias = 'rel';

        const targetSchema = getModel((toEntity as Record<string, unknown>).constructor);

        if (!targetSchema) {
            throw new Error(
                `Couldn't find a model for the target of relationship "${rel.getKey()}"`
            );
        }

        const fromMatch = matchCriteriaForEntity(schema, fromEntity);
        const toMatch = matchCriteriaForEntity(targetSchema, toEntity);

        const builder = new Builder();

        if (fromMatch.elementId) {
            builder.match(fromAlias).whereId(fromAlias, fromMatch.elementId);
        } else {
            builder.match(fromAlias, schema.getLabels(), { [fromMatch.key]: fromMatch.value });
        }

        builder.relationship(rel.getType(), rel.getDirection(), relAlias);

        if (toMatch.elementId) {
            builder.to(toAlias).whereId(toAlias, toMatch.elementId);
        } else {
            builder.to(toAlias, targetSchema.getLabels(), { [toMatch.key]: toMatch.value });
        }

        builder.delete(relAlias);

        const { query, params } = builder.build();

        await this.runner.run(query, params);

        return {
            from: await this.refresh<From>(schema, fromEntity),
            to: await this.refresh<To>(targetSchema, toEntity),
        };
    }

    /**
     * Re-hydrate an entity by its internal id (elementId)
     */
    private async refresh<T extends object>(
        schema: EntitySchema,
        entity: T
    ): Promise<T | undefined> {
        const idKey = schema
            .getProperties()
            .find((property) => property.getType() === PropertyType.INTERNAL_ID)?.getKey();
        const elementId = idKey
            ? (entity as Record<string, unknown>)[idKey]
            : undefined;

        const constructor = (entity as Record<string, unknown>)
            .constructor as Newable | undefined;

        if (!elementId || !constructor) {
            return undefined;
        }

        return new FindByIdService(this.runner)
            .find(constructor, schema, elementId as string) as Promise<T | undefined>;
    }
}
