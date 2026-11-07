import type { Runner } from '../../driver/types.js'
import type { WithMethods } from '../../entity-methods.js'
import { hydrate } from '../../hydrate.js'
import { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { Newable } from '../../meta/newable.js'

/**
A hydrated entity with the relevance score of the index that matched it
*/
export interface ScoredEntity<T> {
  entity: T
  score: number
}

/**
A registered model class or its EntitySchema
*/
export type ModelInput = Newable | EntitySchema

export const resolveModel = (model: ModelInput): Newable =>
  model instanceof EntitySchema ? model.getConstructor() : model

const NODE_ALIAS = 'node'

const requireString = (value: string, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Cannot run a full-text search: ${label} must be a non-empty string`)
  }

  return value
}

/**
Full-text search over a full-text index
(`CALL db.index.fulltext.queryNodes`), returning hydrated entities with
their relevance score, best match first.

The query string is bound as a parameter, so Lucene syntax characters in it
are still parsed as such — pass user text through `toFulltextQuery` first.
*/
export async function search<T>(
  runner: Runner,
  model: ModelInput,
  indexName: string,
  query: string,
  limit?: number,
): Promise<ScoredEntity<T>[]> {
  requireString(indexName, 'index name')
  requireString(query, 'query')

  let statement =
    'CALL db.index.fulltext.queryNodes($index, $q) ' +
    `YIELD ${NODE_ALIAS}, score ` +
    `RETURN ${NODE_ALIAS}, score ORDER BY score DESC`

  const parameters: Record<string, unknown> = { index: indexName, q: query }

  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new TypeError('Cannot run a full-text search: limit must be a positive integer')
    }

    statement += ' LIMIT $limit'
    parameters['limit'] = limit
  }

  const output = await runner.run(statement, parameters)

  // hydrate() keeps only records carrying a node under the alias, in order
  const entities = hydrate<T>(
    resolveModel(model) as new (
      ...arguments_: never[]
    ) => T,
    output,
    NODE_ALIAS,
  )

  return output.records
    .filter((row) => row.has(NODE_ALIAS) && row.get(NODE_ALIAS) != null)
    .map((row, index) => ({ entity: entities[index], score: row.get('score') as number }))
    .filter((item): item is { entity: WithMethods<T>; score: number } => item.entity !== undefined)
}
