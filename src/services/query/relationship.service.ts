import Builder from '../../query/index.js'
import QueryService from './query.service.js'

const REL = 'rel'

export default class RelationshipService extends QueryService {
  /**
  Update the properties of a relationship, matched by element ID or by
  property equality on the relationship itself
  (neode UpdateRelationship.js, elementId instead of id()).
  
  @returns the updated properties, or undefined when nothing matched
  */
  async update(
    match: string | Record<string, unknown>,
    properties: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const builder = new Builder()

    this.matchRelationship(builder, match)

    for (const [key, value] of Object.entries(properties)) {
      if (value !== undefined) {
        builder.set(`${REL}.${key}`, value)
      }
    }

    builder.return(`properties(${REL}) AS props`)

    const { query, params } = builder.build()

    const res = await this.runner.run(query, params)

    return res.records[0]?.get('props') as Record<string, unknown> | undefined
  }

  /**
  Delete a relationship by element ID (neode DeleteRelationship.js)
  */
  async delete(relElementId: string): Promise<void> {
    const builder = new Builder()

    this.matchRelationship(builder, relElementId)
    builder.delete(REL)

    const { query, params } = builder.build()

    await this.runner.run(query, params)
  }

  /**
  `MATCH ()-[rel]-()` plus an elementId or property-equality where clause
  */
  private matchRelationship(builder: Builder, match: string | Record<string, unknown>): void {
    builder.match().relationship(undefined, undefined, REL).toAnything()

    if (typeof match === 'string') {
      builder.where(`elementId(${REL})`, match)
    } else {
      for (const [key, value] of Object.entries(match)) {builder.where(`${REL}.${key}`, value)}
    }
  }
}
