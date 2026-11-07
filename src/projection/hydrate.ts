import neo4j from 'neo4j-driver'
import { getModel } from '../meta/index.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import type { Newable } from '../meta/newable.js'
import { PropertyType } from '../meta/property-schema.js'
import { hydrateNode } from '../utils.js'

/**
Hydrate one row of a projection read (NTS-135/136/137/138).

The RETURN map projection (projectionNode) carries the node properties
inline with the identity markers and eager relationship values — the shape
hydrateNode understands, so projected values land on the entity through
the regular property hydration switch. This pass then post-processes the
projected kinds:

- full-entity @RelatedOne / @RelatedMany values hydrate recursively into
  entities;
- field-subset values stay the plain read-only DTOs the query returned;
- counts / exists / label predicates become primitives;
- @Computed derives its value from the hydrated entity.
*/
export function hydrateProjection<T>(
  schema: EntitySchema,
  constructor: Newable,
  projection: Record<string, unknown>,
): T {
  const entity = hydrateNode<T>(schema, constructor, projection) as unknown as Record<
    string,
    unknown
  >

  for (const property of schema.getProperties()) {
    switch (property.getType()) {
      case PropertyType.RELATED_ONE:
      case PropertyType.RELATED_MANY: {
        // Field subsets are already plain DTOs — nothing to hydrate
        if (property.getFields()?.length) {break}

        const raw = entity[property.getKey()]

        if (raw === undefined || raw === null) {break}

        const targetEntity = property.getEntity()
        const targetSchema = targetEntity ? getModel(targetEntity) : undefined

        // Unregistered target: leave the raw projection in place
        if (!targetSchema) {break}

        entity[property.getKey()] = Array.isArray(raw)
          ? raw.map((item) =>
              hydrateNode(targetSchema, targetEntity, item as Record<string, unknown>),
            )
          : hydrateNode(targetSchema, targetEntity, raw as Record<string, unknown>)
        break
      }

      case PropertyType.RELATIONSHIP_COUNT: {
        const value = entity[property.getKey()]

        // neo4j-driver returns COUNT as an Integer; Relate as a number
        entity[property.getKey()] = neo4j.isInt(value) ? value.toNumber() : Number(value)
        break
      }

      case PropertyType.RELATIONSHIP_EXISTS:
      case PropertyType.LABEL_PRESENT: {
        entity[property.getKey()] = Boolean(entity[property.getKey()])
        break
      }

      case PropertyType.EXPRESSION: {
        break // raw projected value already assigned
      }

      case PropertyType.COMPUTED: {
        entity[property.getKey()] = property.getCompute()!(entity)
        break
      }
    }
  }

  return entity as unknown as T
}
