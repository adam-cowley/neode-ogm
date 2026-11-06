import Builder, { Direction } from '../query'
import { INTERNAL_ID, THIS_NODE } from '../constants'
import { Runner } from '../driver/types'
import { getModel } from '../meta'
import EntitySchema, { EntityType } from '../meta/entity/entity-schema'
import PropertySchema, { PropertyType, isProjectedProperty } from '../meta/property-schema'
import RelationshipPropertySchema from '../meta/relationship-property-schema'
import { getValueOrDefault, setPropertyInBuilder } from '../utils'

/**
 * Maximum nesting depth when creating nested relationship targets
 * (neode WriteUtils parity)
 */
export const MAX_CREATE_DEPTH = 99

/**
 * Create a node for the given schema and model, then recursively create and
 * relate any nested relationship targets present on the model.
 *
 * Port of neode's WriteUtils.addNodeToStatement as one statement per node:
 * each node is a single CREATE, related to recursively created targets by
 * element ID, with a depth cap guarding against runaway (e.g. cyclic) graphs.
 * Returns the created node's element ID.
 */
export async function createNodeAndRelationships(
  runner: Runner,
  schema: EntitySchema,
  model: object,
  depth = 0,
): Promise<string> {
  const thisId = await createNode(runner, schema, model)

  await createRelationships(runner, thisId, schema, model, depth)

  return thisId
}

/**
 * The model's schema-known property values as the write paths apply them:
 * own values with schema defaults resolved (neode validates after
 * GenerateDefaultValues)
 */
export function modelPropertyValues(model: object, schema: EntitySchema): Record<string, unknown> {
  const values: Record<string, unknown> = {}

  schema.getProperties().forEach((property) => {
    // Projected read-model values (counts, DTOs, computed) are never written
    if (isProjectedProperty(property)) return

    const value = getValueOrDefault(model, property, schema)

    if (value !== undefined) {
      values[property.getKey()] = value
    }
  })

  return values
}

/**
 * CREATE (this:Label { ... }) RETURN elementId(this) AS __id
 *
 * neode parity (WriteUtils.splitProperties in create mode): every property
 * value - defaults included - is inlined into the CREATE pattern, because
 * ON CREATE SET / ON MATCH SET are merge-only clauses.
 */
async function createNode(runner: Runner, schema: EntitySchema, model: object): Promise<string> {
  const properties: Record<string, unknown> = {}

  schema.getProperties().forEach((property) => {
    // Mapped / internal / projected properties are not writable
    if (
      property.getType() === PropertyType.INTERNAL_ID ||
      property.getType() === PropertyType.ALL_PROPERTIES ||
      property.getType() === PropertyType.NODE ||
      isProjectedProperty(property)
    ) {
      return
    }

    const value = getValueOrDefault(model, property, schema)

    if (value !== undefined && value !== null) {
      properties[property.getKey()] = value
    }
  })

  const builder = new Builder()

  builder.create(THIS_NODE, schema.getLabels(), properties)
  builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

  const { query, params } = builder.build()

  const result = await runner.run(query, params)

  return result.records[0].get(INTERNAL_ID) as string
}

async function createRelationships(
  runner: Runner,
  thisId: string,
  schema: EntitySchema,
  model: object,
  depth: number,
): Promise<void> {
  // Depth cap: nodes nested deeper than MAX_CREATE_DEPTH are not created
  if (depth >= MAX_CREATE_DEPTH) {
    return
  }

  await Promise.all(
    schema.getRelationships().map(async (rel) => {
      const key = rel.getKey()

      // If property is not set then ignore it
      if (!Object.hasOwn(model, key) || !(model as Record<string, unknown>)[key]) {
        return
      }

      const value = (model as Record<string, unknown>)[key]

      const values = rel.getMany() ? (Array.isArray(value) ? value : [value]) : [value]

      await Promise.all(values.map((target) => createTarget(runner, thisId, rel, target, depth)))
    }),
  )
}

async function createTarget(
  runner: Runner,
  thisId: string,
  rel: RelationshipPropertySchema,
  value: unknown,
  depth: number,
): Promise<void> {
  const targetEntity = rel.getTarget()
  const targetSchema = getModel(targetEntity)

  if (!targetSchema) {
    throw new Error(`Couldn't find a model for the target of relationship "${rel.getKey()}"`)
  }

  // Relationship entity target: create the node at the far end of the
  // relationship, then relate the two nodes with the entity's properties
  // (mirrors MergeService.save)
  if (targetSchema.getType() === EntityType.RelationshipEntity) {
    const otherProperty = getOtherProperty(rel, targetSchema, targetEntity)

    const otherSchema = getModel(otherProperty.getEntity())

    const otherModel = (value as Record<string, unknown>)[otherProperty.getKey()]

    const otherId = await createNodeAndRelationships(
      runner,
      otherSchema,
      otherModel as object,
      depth + 1,
    )

    await relateNodes(runner, thisId, otherId, rel, targetSchema, value)

    return
  }

  const targetId = await createNodeAndRelationships(
    runner,
    targetSchema,
    value as object,
    depth + 1,
  )

  await relateNodes(runner, thisId, targetId, rel, targetSchema, value)
}

/**
 * The relationship entity property holding the node at the far end of the
 * given relationship (mirrors MergeService.save)
 */
function getOtherProperty(
  rel: RelationshipPropertySchema,
  targetSchema: EntitySchema,
  targetEntity: unknown,
): PropertySchema {
  const otherProperty = targetSchema.getProperties().find((property) => {
    if (rel.getDirection() === Direction.OUTGOING) {
      return (
        property.getType() === PropertyType.END_NODE ||
        property.getType() === PropertyType.OTHER_NODE
      )
    }

    if (rel.getDirection() === Direction.INCOMING) {
      return (
        property.getType() === PropertyType.START_NODE ||
        property.getType() === PropertyType.OTHER_NODE
      )
    }

    return false
  })

  if (!otherProperty) {
    throw new Error(
      `Relationship entity "${(targetEntity as { name?: string }).name}" must declare a ` +
        `@StartNode or @EndNode property to be related via "${rel.getKey()}"`,
    )
  }

  return otherProperty
}

/**
 * Relate two created nodes by element ID, setting any relationship entity
 * properties on the new relationship (mirrors MergeService#relateNodes)
 */
async function relateNodes(
  runner: Runner,
  fromId: string,
  toId: string,
  rel: RelationshipPropertySchema,
  targetSchema: EntitySchema,
  entity: unknown,
): Promise<void> {
  const from = 'from'
  const to = 'to'
  const relAlias = 'rel'

  const builder = new Builder()

  builder
    .match(from)
    .whereId(from, fromId)
    .match(to)
    .whereId(to, toId)

    // Merge Relationship
    .merge(from)
    .relationship(rel.getType(), rel.getDirection(), relAlias)
    .to(to)

  // Set relationship properties
  if (targetSchema.getType() === EntityType.RelationshipEntity) {
    targetSchema.getProperties().forEach((property) => {
      const key = property.getKey()

      // Ignore if not set
      if (!Object.hasOwn(entity as Record<string, unknown>, key)) return

      const value = (entity as Record<string, unknown>)[key]

      switch (property.getType()) {
        // Ignore any internals
        case PropertyType.INTERNAL_ID:
        case PropertyType.START_NODE:
        case PropertyType.END_NODE:
        case PropertyType.OTHER_NODE:
          break

        case PropertyType.ALL_PROPERTIES:
          Object.entries(value as Record<string, unknown>).forEach(([, entryValue]) =>
            setPropertyInBuilder(builder, relAlias, property, entryValue),
          )
          break

        default:
          setPropertyInBuilder(builder, relAlias, property, value)
          break
      }
    })
  }

  const { query, params } = builder.build()

  await runner.run(query, params)
}
