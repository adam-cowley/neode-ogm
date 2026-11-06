import Builder from '../../query';
import { GraphRelationship } from '../../driver/types';
import { getModel } from '../../meta';
import EntitySchema, { EntityType } from '../../meta/entity/entity-schema';
import { PropertyType } from '../../meta/property-schema';
import RelationshipPropertySchema from '../../meta/relationship-property-schema';
import { convertPropertyValue, matchCriteriaForEntity } from '../../utils';
import QueryService from './query.service';

/** Property types describing relationship internals, never set on the edge */
const INTERNAL_PROPERTY_TYPES = [
    PropertyType.INTERNAL_ID,
    PropertyType.START_NODE,
    PropertyType.END_NODE,
    PropertyType.OTHER_NODE,
];

export default class RelateService extends QueryService {
    /**
     * Relate two saved nodes, matching both by primary key and then MERGEing
     * the relationship (CREATE with `forceCreate`, neode RelateTo.js parity).
     *
     * With an INCOMING direction the relationship is stored from the target
     * to the source node (neode's DIRECTION_IN swap).
     *
     * When the relationship's target is a relationship entity, the given
     * properties are converted through the relationship entity's property
     * schemas.
     *
     * @returns the created/matched relationship, or undefined when either
     *          node could not be matched
     */
    async relate<From extends object, To extends object>(
        schema: EntitySchema,
        fromEntity: From,
        toEntity: To,
        rel: RelationshipPropertySchema,
        properties: Record<string, unknown> = {},
        forceCreate = false
    ): Promise<GraphRelationship | undefined> {
        const fromAlias = 'from';
        const toAlias = 'to';
        const relAlias = 'rel';

        const fromMatch = matchCriteriaForEntity(schema, fromEntity);

        // Match the target by its own model, falling back to the target
        // declared on the relationship
        const targetSchema = getModel((toEntity as Record<string, unknown>).constructor) ??
            (rel.getTarget() ? getModel(rel.getTarget()) : undefined);

        if (!targetSchema) {
            throw new Error(
                `Couldn't find a model for the target of relationship "${rel.getKey()}"`
            );
        }

        const toMatch = matchCriteriaForEntity(targetSchema, toEntity);

        const builder = new Builder();

        if (fromMatch.elementId) {
            builder.match(fromAlias).whereId(fromAlias, fromMatch.elementId);
        } else {
            builder.match(fromAlias, schema.getLabels(), { [fromMatch.key]: fromMatch.value });
        }

        if (toMatch.elementId) {
            builder.match(toAlias).whereId(toAlias, toMatch.elementId);
        } else {
            builder.match(toAlias, targetSchema.getLabels(), { [toMatch.key]: toMatch.value });
        }

        if (forceCreate) {
            builder.create(fromAlias)
                .relationship(rel.getType(), rel.getDirection(), relAlias)
                .to(toAlias);
        } else {
            builder.merge(fromAlias)
                .relationship(rel.getType(), rel.getDirection(), relAlias)
                .to(toAlias);
        }

        this.setProperties(builder, rel, relAlias, properties);

        builder.return(relAlias);

        const { query, params } = builder.build();

        const res = await this.runner.run(query, params);

        return res.records[0]?.get(relAlias) as GraphRelationship | undefined;
    }

    /**
     * Set relationship properties. When the relationship's target is a
     * relationship entity, values are converted through that entity's
     * property schemas and internal node/relationship references are skipped.
     */
    private setProperties(
        builder: Builder,
        rel: RelationshipPropertySchema,
        relAlias: string,
        properties: Record<string, unknown>
    ): void {
        const relTargetSchema = rel.getTarget()
            ? getModel(rel.getTarget())
            : undefined;

        const relationshipEntity =
            relTargetSchema?.getType() === EntityType.RelationshipEntity;

        Object.entries(properties).forEach(([key, value]) => {
            if (value === undefined) {
                return;
            }

            if (!relationshipEntity) {
                builder.set(`${relAlias}.${key}`, value);

                return;
            }

            const property = relTargetSchema!
                .getProperties()
                .find((candidate) => candidate.getKey() === key);

            if (property && INTERNAL_PROPERTY_TYPES.includes(property.getType())) {
                return;
            }

            builder.set(
                `${relAlias}.${key}`,
                property ? convertPropertyValue(value, property) : value
            );
        });
    }
}

/**
 * Primary key name and value of a saved entity. Relating matches nodes by
 * primary key, so an unsaved entity is a caller error.
 */
