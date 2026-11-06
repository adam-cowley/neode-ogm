import Builder, { Direction } from '../../query';
import { INTERNAL_ID, THIS_NODE } from '../../constants';
import { getModel } from '../../meta';
import EntitySchema, { EntityType } from '../../meta/entity/entity-schema';
import PropertySchema, { PropertyType } from '../../meta/property-schema';
import RelationshipPropertySchema from '../../meta/relationship-property-schema';
import { getValueOrDefault, getValuesAsRecord, setPropertyInBuilder } from '../../utils';
import QueryService from './query.service';

export default class MergeService extends QueryService {
    async save(model: object, schema: EntitySchema): Promise<{ elementId: string }> {
        const builder = new Builder();

        let mergeOn: Record<string, unknown>;

        // Primary Key?
        const primaryKeys = schema
            .getProperties()
            .filter(
                (property) =>
                    property.isPrimaryKey() &&
                    Object.hasOwn(model, property.getKey()) &&
                    (model as Record<string, unknown>)[property.getKey()] !== undefined
            );

        if (primaryKeys.length) {
            mergeOn = getValuesAsRecord(model, primaryKeys, schema);
        }

        // No primary keys: fall back to unique values
        else {
            const unique = schema.getProperties().filter((property) => property.isUnique());

            mergeOn = getValuesAsRecord(model, unique, schema);
        }

        builder.merge(THIS_NODE, schema.getLabels(), mergeOn);

        // Set Properties
        schema.getProperties().forEach((property) => {
            const value = getValueOrDefault(model, property, schema);

            // If property is not set then ignore it
            if (value !== undefined) {
                setPropertyInBuilder(builder, THIS_NODE, property, value);
            }
        });

        builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`);

        // Build Cypher
        const { query, params } = builder.build();

        // Run it!
        const result = await this.runner.run(query, params);

        // Get element ID
        const thisId = result.records[0].get(INTERNAL_ID) as string;

        // Save relationship targets in the same transaction
        await Promise.all(
            schema.getRelationships().map(async (rel) => {
                const key = rel.getKey();

                const targetEntity = rel.getTarget();
                const targetSchema = getModel(targetEntity);

                // If property is not set then ignore it
                if (Object.hasOwn(model, key) && (model as Record<string, unknown>)[key]) {
                    const values: unknown[] = rel.getMany()
                        ? ((model as Record<string, unknown>)[key] as unknown[])
                        : [(model as Record<string, unknown>)[key]];

                    if (targetSchema.getType() === EntityType.RelationshipEntity) {
                        return Promise.all(
                            values.map(async (value) => {
                                let otherProperty: PropertySchema | undefined;

                                if (rel.getDirection() === Direction.OUTGOING) {
                                    otherProperty = targetSchema
                                        .getProperties()
                                        .find(
                                            (property) =>
                                                property.getType() === PropertyType.END_NODE ||
                                                property.getType() === PropertyType.OTHER_NODE
                                        );
                                } else if (rel.getDirection() === Direction.INCOMING) {
                                    otherProperty = targetSchema
                                        .getProperties()
                                        .find(
                                            (property) =>
                                                property.getType() === PropertyType.START_NODE ||
                                                property.getType() === PropertyType.OTHER_NODE
                                        );
                                }

                                if (!otherProperty) {
                                    throw new Error(
                                        `Relationship entity "${targetEntity?.name}" must declare a ` +
                                            `@StartNode or @EndNode property to be related via "${rel.getKey()}"`
                                    );
                                }

                                const otherEntity = otherProperty.getEntity();
                                const otherSchema = getModel(otherEntity);                                // TODO: Validate the other object
                                const otherModel = (value as Record<string, unknown>)[
                                    otherProperty.getKey()
                                ] as object;

                                const res = await this.save(otherModel, otherSchema);

                                await this.relateNodes(thisId, res.elementId, rel, targetSchema, value);
                            })
                        );
                    }

                    return Promise.all(
                        values.map(async (value) => {
                            // Save Node
                            const res = await this.save(
                                value as object,
                                targetSchema
                            );

                            // Relate the two nodes together
                            await this.relateNodes(thisId, res.elementId, rel, targetSchema, value);
                        })
                    );
                }

                return Promise.resolve();
            })
        );

        return { elementId: thisId };
    }

    private relateNodes<T>(
        fromId: string,
        toId: string,
        rel: RelationshipPropertySchema,
        targetSchema: EntitySchema,
        entity: T
    ): Promise<unknown> {
        const fromNode = 'from';
        const toNode = 'to';
        const thisRel = 'rel';

        const builder = new Builder();

        // Match nodes by element ID, falling back to a merge if unknown
        builder.match(fromNode).whereId(fromNode, fromId).match(toNode).whereId(toNode, toId)

            // Merge Relationship
            .merge(fromNode)
            .relationship(rel.getType(), rel.getDirection(), thisRel)
            .to(toNode);

        // Set relationship properties
        if (targetSchema.getType() === EntityType.RelationshipEntity) {
            targetSchema.getProperties().forEach((property) => {
                const key = property.getKey();

                // Ignore if not set
                if (!Object.hasOwn(entity as Record<string, unknown>, key)) return;

                const value = (entity as Record<string, unknown>)[key];

                switch (property.getType()) {
                    // Ignore any internals
                    case PropertyType.INTERNAL_ID:
                    case PropertyType.START_NODE:
                    case PropertyType.END_NODE:
                    case PropertyType.OTHER_NODE:
                        break;

                    case PropertyType.ALL_PROPERTIES:
                        Object.entries(value as Record<string, unknown>).forEach(
                            ([_entryKey, entryValue]) =>
                                setPropertyInBuilder(builder, thisRel, property, entryValue)
                        );
                        break;

                    default:
                        setPropertyInBuilder(builder, thisRel, property, value);
                        break;
                }
            });
        }

        const { query, params } = builder.build();

        return this.runner.run(query, params);
    }
}
