import Builder from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import { getModel } from '../../meta/index.js'
import type EntitySchema from '../../meta/entity/entity-schema.js'
import type RelationshipPropertySchema from '../../meta/relationship-property-schema.js'
import QueryService from './query.service.js'

/**
Maximum cascade deletion depth (neode DeleteNode.js parity)
*/
export const MAX_CASCADE_DEPTH = 10

export interface DeleteOptions {
  /**
  Cascade into the related entities declared on the schema
  */
  cascade?: boolean

  /**
  'delete' (default) deletes related nodes recursively;
  'detach' removes only the relationships, keeping the related nodes
  */
  mode?: 'delete' | 'detach'

  /**
  Maximum cascade depth, defaults to {@link MAX_CASCADE_DEPTH}
  */
  depth?: number

  /**
  Soft delete: SET this label on the node instead of deleting it
  (labels-as-state lifecycle). Cascade options are ignored.
  */
  soft?: string
}

export default class DeleteService extends QueryService {
  /**
  Delete a node. Without options this is a plain DETACH DELETE.
  
  Note: RelationshipPropertySchema has no per-relationship cascade flag,
  so when cascading, every relationship declared on the schema cascades
  (neode keys this off relationship.cascade()).
  */
  async delete<T extends object>(
    schema: EntitySchema,
    entity: T,
    options?: DeleteOptions,
  ): Promise<void> {
    const builder = new Builder()

    const primaryKey = schema.getPrimaryKey()!.getKey()
    const value = (entity as Record<string, unknown>)[primaryKey]

    builder.match(THIS_NODE, schema.getLabels(), { [primaryKey]: value })

    // Soft delete: SET the label instead of deleting the node
    if (options?.soft) {
      builder.set(`${THIS_NODE}:${options.soft}`, undefined)

      const { query, params } = builder.build()

      await this.runner.run(query, params)

      return
    }

    const isCascade = options?.cascade === true || options?.mode !== undefined

    if (isCascade && options?.mode === 'detach') {
      // Delete the relationships to related nodes first, then the node
      // itself: related nodes survive (neode DeleteNode.js addDetachNode)
      for (const rel of schema.getRelationships()) {
        const relAlias = `${THIS_NODE}_${rel.getKey()}_rel`

        builder
          .optionalMatch(THIS_NODE)
          .relationship(rel.getType(), rel.getDirection(), relAlias)
          .toAnything()
          .delete(relAlias)
      }

      builder.detachDelete(THIS_NODE)
    } else if (isCascade) {
      // Recursively match and delete related nodes, bounded by depth
      // (neode DeleteNode.js addCascadeDeleteNode)
      for (const rel of schema
        .getRelationships()) {this.addCascadeDelete(builder, THIS_NODE, rel, 1, options?.depth ?? MAX_CASCADE_DEPTH)}
        

      builder.detachDelete(THIS_NODE)
    } else {
      builder.detachDelete(THIS_NODE)
    }

    const { query, params } = builder.build()

    await this.runner.run(query, params)
  }

  /**
  Add an optional match of a related node plus its own cascades, then
  delete it. `depth` is the number of relationship hops from the root.
  */
  private addCascadeDelete(
    builder: Builder,
    fromAlias: string,
    rel: RelationshipPropertySchema,
    depth: number,
    maxDepth: number,
  ): void {
    if (depth > maxDepth) {
      return
    }

    const relAlias = `${fromAlias}_${rel.getKey()}_rel`
    const nodeAlias = `${fromAlias}_${rel.getKey()}_node`
    const targetSchema = rel.getTarget() ? getModel(rel.getTarget()) : undefined

    builder
      .optionalMatch(fromAlias)
      .relationship(rel.getType(), rel.getDirection(), relAlias)
      .to(nodeAlias, targetSchema?.getLabels() ?? false)

    if (targetSchema) {
      for (const targetRel of targetSchema
        .getRelationships()) {this.addCascadeDelete(builder, nodeAlias, targetRel, depth + 1, maxDepth)}
        
    }

    builder.detachDelete(nodeAlias)
  }
}
