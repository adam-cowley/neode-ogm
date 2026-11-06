import Builder, { Direction } from '../../query/index.js'
import { INTERNAL_ID, THIS_NODE } from '../../constants.js'
import type { QueryOutput } from '../../driver/types.js'
import { getModel } from '../../meta/index.js'
import type EntitySchema from '../../meta/entity/entity-schema.js';
import { EntityType } from '../../meta/entity/entity-schema.js'
import type PropertySchema from '../../meta/property-schema.js';
import { PropertyType, isProjectedProperty } from '../../meta/property-schema.js'
import type RelationshipPropertySchema from '../../meta/relationship-property-schema.js'
import { getValueOrDefault, getValuesAsRecord, setPropertyInBuilder } from '../../utils.js'
import { modelPropertyValues } from '../write-utils.js'
import { validate } from '../../validation/index.js'
import QueryService from './query.service.js'

/**
Properties used for merge matching: unique OR indexed
(neode's Model.mergeFields)
*/
export function getMergeFields(schema: EntitySchema): PropertySchema[] {
  return schema.getProperties().filter((property) => property.isUnique() || property.isIndex())
}

export default class MergeService extends QueryService {
  /**
  MERGE a node on the given match properties, then set the given properties
  */
  async mergeOn(
    schema: EntitySchema,
    match: Record<string, unknown>,
    set: Record<string, unknown> = {},
  ): Promise<QueryOutput> {
    // Skip undefined match values
    const matchRecord = Object.fromEntries(
      Object.entries(match).filter(([, value]) => value !== undefined),
    )

    if (Object.keys(matchRecord).length === 0) {
      throw new Error('mergeOn requires at least one match property')
    }

    // Validate the combined match + set values before writing (neode
    // validates both), with the same defaults the set clause applies
    const written: Record<string, unknown> = { ...matchRecord }

    for (const property of schema.getProperties()) {
      if (Object.hasOwn(matchRecord, property.getKey()) || isProjectedProperty(property)) {continue}

      const value = getValueOrDefault(set, property, schema)

      if (value !== undefined) {
        written[property.getKey()] = value
      }
    }

    validate(written, schema)

    const builder = new Builder()

    builder.merge(THIS_NODE, schema.getLabels(), matchRecord)

    // Set Properties: explicit set values, falling back to schema
    // defaults (e.g. a UUID primary key on create). Unset values are
    // skipped rather than deleted.
    for (const property of schema.getProperties()) {
      const key = property.getKey()

      // Match properties are inline in the MERGE, not set; projected
      // read-model values are never written
      if (Object.hasOwn(matchRecord, key)) {continue}
      if (isProjectedProperty(property)) {continue}

      const value = getValueOrDefault(set, property, schema)

      if (value !== undefined) {
        setPropertyInBuilder(builder, THIS_NODE, property, value)
      }
    }

    // Extra keys not declared on the schema are plain property sets
    for (const [key, value] of Object.entries(set)) {
      if (
        value === undefined ||
        schema.getProperties().some((property) => property.getKey() === key)
      ) {
        continue
      }

      builder.set(`${THIS_NODE}.${key}`, value)
    }

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    const { query, params } = builder.build()

    return this.runner.run(query, params)
  }

  async save(model: object, schema: EntitySchema): Promise<{ elementId: string }> {
    // Validate the model's own values (defaults resolved) before any write
    validate(modelPropertyValues(model, schema), schema)

    const builder = new Builder()

    let mergeOn: Record<string, unknown>

    // Primary Key?
    const primaryKeys = schema
      .getProperties()
      .filter(
        (property) =>
          property.isPrimaryKey() &&
          Object.hasOwn(model, property.getKey()) &&
          (model as Record<string, unknown>)[property.getKey()] !== undefined,
      )

    if (primaryKeys.length > 0) {
      mergeOn = getValuesAsRecord(model, primaryKeys, schema)
    }

    // No primary keys: fall back to the merge fields (unique or indexed)
    else {
      mergeOn = getValuesAsRecord(model, getMergeFields(schema), schema)
    }

    builder.merge(THIS_NODE, schema.getLabels(), mergeOn)

    // Set Properties
    for (const property of schema.getProperties()) {
      // Projected read-model values are never written
      if (isProjectedProperty(property)) {continue}

      const value = getValueOrDefault(model, property, schema)

      // If property is not set then ignore it
      if (value !== undefined) {
        setPropertyInBuilder(builder, THIS_NODE, property, value)
      }
    }

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    // Build Cypher
    const { query, params } = builder.build()

    // Run it!
    const result = await this.runner.run(query, params)

    // Get element ID
    const firstRecord = result.records[0]

    if (firstRecord === undefined) {
      throw new Error('relate statement returned no records')
    }

    const thisId = firstRecord.get(INTERNAL_ID)

    if (typeof thisId !== 'string') {
      throw new Error(`relate statement did not return an ${INTERNAL_ID}`)
    }

    // Save relationship targets in the same transaction
    await Promise.all(
      schema.getRelationships().map(async (rel) => {
        const key = rel.getKey()

        const targetEntity = rel.getTarget()
        const targetSchema = getModel(targetEntity)

        // If property is not set then ignore it
        if (Object.hasOwn(model, key) && (model as Record<string, unknown>)[key]) {
          const values: unknown[] = rel.getMany()
            ? ((model as Record<string, unknown>)[key] as unknown[])
            : [(model as Record<string, unknown>)[key]]

          if (targetSchema.getType() === EntityType.RelationshipEntity) {
            return Promise.all(
              values.map(async (value) => {
                let otherProperty: PropertySchema | undefined

                if (rel.getDirection() === Direction.OUTGOING) {
                  otherProperty = targetSchema
                    .getProperties()
                    .find(
                      (property) =>
                        property.getType() === PropertyType.END_NODE ||
                        property.getType() === PropertyType.OTHER_NODE,
                    )
                } else if (rel.getDirection() === Direction.INCOMING) {
                  otherProperty = targetSchema
                    .getProperties()
                    .find(
                      (property) =>
                        property.getType() === PropertyType.START_NODE ||
                        property.getType() === PropertyType.OTHER_NODE,
                    )
                }

                if (!otherProperty) {
                  throw new Error(
                    `Relationship entity "${targetEntity?.name}" must declare a ` +
                      `@StartNode or @EndNode property to be related via "${rel.getKey()}"`,
                  )
                }

                const otherEntity = otherProperty.getEntity()
                const otherSchema = getModel(otherEntity) // TODO: Validate the other object
                const otherModel = (value as Record<string, unknown>)[
                  otherProperty.getKey()
                ] as object

                const res = await this.save(otherModel, otherSchema)

                await this.relateNodes(thisId, res.elementId, rel, targetSchema, value)
              }),
            )
          }

          return Promise.all(
            values.map(async (value) => {
              // Save Node
              const res = await this.save(value as object, targetSchema)

              // Relate the two nodes together
              await this.relateNodes(thisId, res.elementId, rel, targetSchema, value)
            }),
          )
        }

        return;
      }),
    )

    return { elementId: thisId }
  }

  private async relateNodes<T>(
    fromId: string,
    toId: string,
    rel: RelationshipPropertySchema,
    targetSchema: EntitySchema,
    entity: T,
  ): Promise<unknown> {
    const fromNode = 'from'
    const toNode = 'to'
    const thisRel = 'rel'

    const builder = new Builder()

    // Match nodes by element ID, falling back to a merge if unknown
    builder
      .match(fromNode)
      .whereId(fromNode, fromId)
      .match(toNode)
      .whereId(toNode, toId)

      // Merge Relationship
      .merge(fromNode)
      .relationship(rel.getType(), rel.getDirection(), thisRel)
      .to(toNode)

    // Set relationship properties
    if (targetSchema.getType() === EntityType.RelationshipEntity) {
      for (const property of targetSchema.getProperties()) {
        const key = property.getKey()

        // Ignore if not set
        if (!Object.hasOwn(entity as Record<string, unknown>, key)) {continue}

        const value = (entity as Record<string, unknown>)[key]

        switch (property.getType()) {
          // Ignore any internals
          case PropertyType.INTERNAL_ID:
          case PropertyType.START_NODE:
          case PropertyType.END_NODE:
          case PropertyType.OTHER_NODE: {
            break
          }

          case PropertyType.ALL_PROPERTIES: {
            for (const entryValue of Object.values(value as Record<string, unknown>)) {setPropertyInBuilder(builder, thisRel, property, entryValue)}
            
            break
          }

          default: {
            setPropertyInBuilder(builder, thisRel, property, value)
            break
          }
        }
      }
    }

    const { query, params } = builder.build()

    return this.runner.run(query, params)
  }
}
