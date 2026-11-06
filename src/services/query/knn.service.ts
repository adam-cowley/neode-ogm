import { Runner } from '../../driver/types'
import { hydrate } from '../../hydrate'
import { getModel } from '../../meta'
import EntitySchema from '../../meta/entity/entity-schema'
import { ScoredEntity, ModelInput, resolveModel } from './search.service'

/** Which query form to use for the kNN search */
export type KnnMode =
  /** Try the Cypher 25 `SEARCH` clause, fall back to the procedure (default) */
  | 'auto'
  /** Cypher 25 `SEARCH ... IN (VECTOR INDEX ...)` clause only */
  | 'search-clause'
  /** `CALL db.index.vector.queryNodes(...)` procedure only */
  | 'procedure'

const NODE_ALIAS = 'node'

/**
 * The Cypher 25 SEARCH clause form — the procedure is deprecated on Cypher 25
 * backends. The index name cannot be bound as a parameter in this form, so it
 * is inlined (backtick-escaped).
 */
export function knnSearchClauseStatement(label: string, indexName: string): string {
  return (
    `MATCH (n:${label}) ` +
    `SEARCH n IN (VECTOR INDEX \`${indexName.replaceAll('`', '``')}\` FOR $vector LIMIT $k) ` +
    `SCORE AS score ` +
    `RETURN n AS ${NODE_ALIAS}, score ORDER BY score DESC`
  )
}

/** The db.index.vector.queryNodes procedure form, supported on Neo4j 5.11+ */
export function knnProcedureStatement(): string {
  return (
    `CALL db.index.vector.queryNodes($index, $k, $vector) ` +
    `YIELD ${NODE_ALIAS}, score ` +
    `RETURN ${NODE_ALIAS}, score ORDER BY score DESC`
  )
}

/**
 * k-nearest-neighbour search over a vector index, returning hydrated
 * entities with their similarity score, best match first.
 *
 * With the default `auto` mode the Cypher 25 `SEARCH` clause is attempted
 * first and the queryNodes procedure is used as a fallback; when the backend
 * supports neither a combined error is raised.
 */
export async function knn<T>(
  runner: Runner,
  model: ModelInput,
  indexName: string,
  vector: number[],
  k: number,
  mode: KnnMode = 'auto',
): Promise<ScoredEntity<T>[]> {
  if (typeof indexName !== 'string' || indexName.length === 0) {
    throw new TypeError('Cannot run a kNN search: index name must be a non-empty string')
  }

  if (
    !Array.isArray(vector) ||
    vector.length === 0 ||
    vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new TypeError(
      'Cannot run a kNN search: vector must be a non-empty array of finite numbers',
    )
  }

  if (!Number.isInteger(k) || k <= 0) {
    throw new TypeError('Cannot run a kNN search: k must be a positive integer')
  }

  // The label scopes the MATCH; a vector index itself targets one label
  const schema = model instanceof EntitySchema ? model : getModel(model)

  if (!schema) {
    throw new Error('Cannot run a kNN search: no registered model found for the given constructor')
  }

  const label = schema.getLabels()[0]

  if (!label) {
    throw new Error('Cannot run a kNN search: the schema has no label to match against')
  }

  const constructor = resolveModel(model)
  const params = { index: indexName, k, vector }

  const runForm = async (statement: string): Promise<ScoredEntity<T>[]> => {
    const output = await runner.run(statement, params)

    // hydrate() keeps only records carrying a node under the alias, in order
    const entities = hydrate<T>(constructor as new (...args: never[]) => T, output, NODE_ALIAS)

    return output.records
      .filter((row) => row.has(NODE_ALIAS) && row.get(NODE_ALIAS) != null)
      .map((row, i) => ({ entity: entities[i], score: row.get('score') as number }))
  }

  if (mode === 'procedure') {
    return runForm(knnProcedureStatement())
  }

  if (mode === 'search-clause') {
    return runForm(knnSearchClauseStatement(label, indexName))
  }

  let searchClauseError: unknown

  try {
    return await runForm(knnSearchClauseStatement(label, indexName))
  } catch (e) {
    searchClauseError = e
  }

  try {
    return await runForm(knnProcedureStatement())
  } catch (procedureError) {
    throw new Error(
      'Cannot run a kNN search: the backend supports neither the Cypher 25 SEARCH clause ' +
        `(${(searchClauseError as Error).message}) ` +
        `nor the db.index.vector.queryNodes procedure (${(procedureError as Error).message})`,
    )
  }
}
