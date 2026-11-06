import Builder from '../../query';
import { INTERNAL_ID, THIS_NODE } from '../../constants';
import { GraphNode, QueryOutput } from '../../driver/types';
import { PropertyType } from '../../meta/property-schema';
import EntitySchema from '../../meta/entity/entity-schema';
import QueryService from './query.service';

/** Property types that reference entities or internals — never plain values */
const NON_VALUE_TYPES = new Set([
    PropertyType.INTERNAL_ID,
    PropertyType.ALL_PROPERTIES,
    PropertyType.ONE_TO_ONE,
    PropertyType.ONE_TO_MANY,
    PropertyType.START_NODE,
    PropertyType.END_NODE,
    PropertyType.OTHER_NODE,
    PropertyType.NODE,
    PropertyType.RELATIONSHIP,
]);

export default class UpdateService extends QueryService {
    /**
     * Update a node's properties, matched by the entity's primary key value.
     *
     * `+=` semantics: only the provided keys are written. Primary key,
     * protected, readonly and hidden properties are never overwritten, and
     * neither are relationship / node / internal-id properties. Required
     * properties that would end up unset keep their current stored value
     * (matching neode's Node#update, which re-reads required properties).
     */
    async update<T extends object>(
        schema: EntitySchema,
        entity: T,
        properties: Record<string, unknown>
    ): Promise<QueryOutput> {
        const pkKey = schema.getPrimaryKey()?.getKey();
        const identity = pkKey ? (entity as Record<string, unknown>)[pkKey] : undefined;

        if (pkKey === undefined || identity === undefined) {
            throw new Error(
                `Cannot update ${schema.getLabels().join(':') || 'entity'}: ` +
                    'no primary key value to match on'
            );
        }

        // Properties an update must never overwrite
        const guarded = new Set(
            schema
                .getProperties()
                .filter(
                    (property) =>
                        property.isPrimaryKey() ||
                        property.isProtected() ||
                        property.isHidden() ||
                        property.isReadonly() ||
                        NON_VALUE_TYPES.has(property.getType())
                )
                .map((property) => property.getKey())
        );

        schema.getRelationships().forEach((rel) => guarded.add(rel.getKey()));

        // Provided keys only (`+=`); undefined means "not provided", null unsets
        const set: Record<string, unknown> = {};

        Object.entries(properties).forEach(([key, value]) => {
            if (value === undefined || guarded.has(key)) return;

            set[key] = value;
        });

        // Required refill: a required property that would end up unset keeps
        // its current stored value
        const refill = schema
            .getProperties()
            .filter((property) => {
                if (!property.isRequired()) return false;

                const value = set[property.getKey()];

                return value === undefined || value === null;
            });

        if (refill.length) {
            const node = await this.readNode(schema, pkKey, identity);

            refill.forEach((property) => {
                const stored = node?.properties[property.getKey()];

                if (stored !== undefined && stored !== null) {
                    set[property.getKey()] = stored;
                }
            });
        }

        // Nothing left to write
        if (Object.keys(set).length === 0) {
            return { records: [] };
        }

        const builder = new Builder();

        builder.match(THIS_NODE, schema.getLabels(), { [pkKey]: identity });

        builder.set(THIS_NODE, set, '+=');

        builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`);

        const { query, params } = builder.build();

        return this.runner.run(query, params);
    }

    /** Read the node's current properties (required-property refill source) */
    private async readNode(
        schema: EntitySchema,
        pkKey: string,
        identity: unknown
    ): Promise<GraphNode | undefined> {
        const builder = new Builder();

        builder.match(THIS_NODE, schema.getLabels(), { [pkKey]: identity });

        builder.return(THIS_NODE);

        const { query, params } = builder.build();

        const res = await this.runner.run(query, params);

        return res.records[0]?.get(THIS_NODE) as GraphNode | undefined;
    }
}
