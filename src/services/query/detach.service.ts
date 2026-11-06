import Builder from '../../query'
import { getModel } from '../../meta'
import EntitySchema from '../../meta/entity/entity-schema'
import { Newable } from '../../meta/newable'
import RelationshipPropertySchema from '../../meta/relationship-property-schema'
import { elementIdOfEntity, matchCriteriaForEntity } from '../../utils'
import FindByIdService from './find-by-id.service'
import QueryService from './query.service'

export interface DetachResult<From, To> {
  from: From | undefined
  to: To | undefined
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
    rel: RelationshipPropertySchema,
  ): Promise<DetachResult<From, To>> {
    const fromAlias = 'from'
    const toAlias = 'to'
    const relAlias = 'rel'

    const targetSchema = getModel((toEntity as Record<string, unknown>).constructor)

    if (!targetSchema) {
      throw new Error(`Couldn't find a model for the target of relationship "${rel.getKey()}"`)
    }

    const fromMatch = matchCriteriaForEntity(schema, fromEntity)
    const toMatch = matchCriteriaForEntity(targetSchema, toEntity)

    const builder = new Builder()

    builder.matchEntity(fromAlias, schema, fromMatch)

    builder.relationship(rel.getType(), rel.getDirection(), relAlias)

    builder.toEntity(toAlias, targetSchema, toMatch)

    builder.delete(relAlias)

    const { query, params } = builder.build()

    await this.runner.run(query, params)

    return {
      from: await this.refresh<From>(schema, fromEntity),
      to: await this.refresh<To>(targetSchema, toEntity),
    }
  }

  /**
   * Re-hydrate an entity by its elementId
   */
  private async refresh<T extends object>(schema: EntitySchema, entity: T): Promise<T | undefined> {
    const elementId = elementIdOfEntity(schema, entity)

    const constructor = (entity as Record<string, unknown>).constructor as Newable | undefined

    if (!elementId || !constructor) {
      return undefined
    }

    return new FindByIdService(this.runner).find(constructor, schema, elementId) as Promise<
      T | undefined
    >
  }
}
