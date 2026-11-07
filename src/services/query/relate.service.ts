import { Builder } from '../../query/index.js'
import type { GraphRelationship } from '../../driver/types.js'
import { getModel } from '../../meta/index.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js';
import { EntityType } from '../../meta/entity/entity-schema.js'
import { PropertyType } from '../../meta/property-schema.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { convertPropertyValue, matchCriteriaForEntity } from '../../utils.js'
import QueryService from './query.service.js'

/**
Property types describing relationship internals, never set on the edge
*/
const INTERNAL_PROPERTY_TYPES = new Set<PropertyType>([
  PropertyType.INTERNAL_ID,
  PropertyType.START_NODE,
  PropertyType.END_NODE,
  PropertyType.OTHER_NODE,
])

export default class RelateService extends QueryService {
  /**
  Relate two saved nodes, matching both by primary key and then MERGEing
  the relationship (CREATE with `forceCreate`, neode RelateTo.js parity).
  
  With an INCOMING direction the relationship is stored from the target
  to the source node (neode's DIRECTION_IN swap).
  
  When the relationship's target is a relationship entity, the given
  properties are converted through the relationship entity's property
  schemas.
  
  @returns the created/matched relationship, or undefined when either
           node could not be matched
  */
  async relate<From extends object, To extends object>(
    schema: EntitySchema,
    fromEntity: From,
    toEntity: To,
    rel: RelationshipPropertySchema,
    properties: Record<string, unknown> = {},
    forceCreate = false,
  ): Promise<GraphRelationship | undefined> {
    const fromAlias = 'from'
    const toAlias = 'to'
    const relAlias = 'rel'

    const fromMatch = matchCriteriaForEntity(schema, fromEntity)

    // Match the target by its own model, falling back to the target
    // declared on the relationship
    const targetSchema =
      getModel((toEntity as Record<string, unknown>).constructor) ??
      (rel.getTarget() ? getModel(rel.getTarget()) : undefined)

    if (!targetSchema) {
      throw new Error(`Couldn't find a model for the target of relationship "${rel.getKey()}"`)
    }

    const toMatch = matchCriteriaForEntity(targetSchema, toEntity)

    const builder = new Builder()

    builder.matchEntity(fromAlias, schema, fromMatch)
    builder.matchEntity(toAlias, targetSchema, toMatch)

    if (forceCreate) {
      builder
        .create(fromAlias)
        .relationship(rel.getType(), rel.getDirection(), relAlias)
        .to(toAlias)
    } else {
      builder.merge(fromAlias).relationship(rel.getType(), rel.getDirection(), relAlias).to(toAlias)
    }

    this.setProperties(builder, rel, relAlias, properties)

    builder.return(relAlias)

    const { query, params } = builder.build()

    const res = await this.runner.run(query, params)

    return res.records[0]?.get(relAlias) as GraphRelationship | undefined
  }

  /**
  Set relationship properties. When the relationship's target is a
  relationship entity, values are converted through that entity's
  property schemas and internal node/relationship references are skipped.
  */
  private setProperties(
    builder: Builder,
    rel: RelationshipPropertySchema,
    relAlias: string,
    properties: Record<string, unknown>,
  ): void {
    const relTargetSchema = rel.getTarget() ? getModel(rel.getTarget()) : undefined

    const isRelationshipEntity = relTargetSchema?.getType() === EntityType.RelationshipEntity

    for (const [key, value] of Object.entries(properties)) {
      if (value === undefined) {
        continue
      }

      if (!isRelationshipEntity) {
        builder.set(`${relAlias}.${key}`, value)

        continue
      }

      const property = relTargetSchema
        .getProperties()
        .find((candidate) => candidate.getKey() === key)

      if (property && INTERNAL_PROPERTY_TYPES.has(property.getType())) {
        continue
      }

      builder.set(`${relAlias}.${key}`, property ? convertPropertyValue(value, property) : value)
    }
  }
}

/**
Primary key name and value of a saved entity. Relating matches nodes by
primary key, so an unsaved entity is a caller error.
*/
