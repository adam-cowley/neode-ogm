import type { ConnectionProvider, QueryOutput, Runner } from '../../driver/types.js'
import { THIS_NODE } from '../../constants.js'
import { hydrate } from '../../hydrate.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { PropertyType, isProjectedProperty } from '../../meta/property-schema.js'
import { getValueOrDefault } from '../../utils.js'
import { modelPropertyValues } from '../write-utils.js'
import { validate } from '../../validation/index.js'
import QueryService from './query.service.js'
import { getMergeFields } from './merge.service.js'

/**
Rows per UNWIND statement / managed write transaction. Chunking keeps
each statement's parameter map within driver limits (the reason the
chunkSize option exists at all)
*/
export const DEFAULT_CHUNK_SIZE = 1000

/**
Property types that are never written as node properties
*/
const NON_WRITABLE_TYPES = new Set<PropertyType>([
  PropertyType.INTERNAL_ID,
  PropertyType.ALL_PROPERTIES,
  PropertyType.NODE,
])

export interface BulkOptions {
  /**
  Rows per statement and per write transaction (default 1000)
  */
  chunkSize?: number

  /**
  Per-call database override (a bare Runner runs in its own scope)
  */
  database?: string | undefined
}

/**
The result of one chunk: the rows attempted and the hydrated
created/merged entities, in row order
*/
export interface BulkChunk<T> {
  count: number
  entities: T[]
}

/**
Split rows into chunks of at most chunkSize
*/
export function chunk<T>(rows: T[], chunkSize: number): T[][] {
  requireChunkSize(chunkSize)

  const chunks: T[][] = []

  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize))
  }

  return chunks
}

function requireChunkSize(chunkSize: number): void {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(`chunkSize must be a positive integer, received ${chunkSize}`)
  }
}

/**
`:Label:Label` node pattern suffix for a schema's labels
*/
export function labelPattern(labels: string[]): string {
  return labels.length > 0 ? `:${labels.join(':')}` : ''
}

/**
Validate a row exactly like the single-create path (defaults resolved,
Zod rules applied) and reduce it to the plain property map the UNWIND
statement writes
*/
export function processCreateRow(
  row: Record<string, unknown>,
  schema: EntitySchema,
): Record<string, unknown> {
  // Bulk rows are flat: a declared relationship key would otherwise be
  // silently dropped
  const relationship = schema
    .getRelationships()
    .find((rel) => row[rel.getKey()] !== undefined && row[rel.getKey()] !== null)

  if (relationship) {
    throw new Error(
      `createMany does not support nested relationship values ("${relationship.getKey()}" given); ` +
        'create relationships separately',
    )
  }

  validate(modelPropertyValues(row, schema), schema)

  const values: Record<string, unknown> = {}

  for (const property of schema.getProperties()) {
    if (NON_WRITABLE_TYPES.has(property.getType()) || isProjectedProperty(property)) {continue}

    const value = getValueOrDefault(row, property, schema)

    // Like the single-create pattern: unset and null properties are skipped
    if (value !== undefined && value !== null) {
      values[property.getKey()] = value
    }
  }

  return values
}

/**
Validate a row and split it into the merge match (the merge fields —
unique, indexed or primary key properties — the row explicitly sets,
never default-resolved) and the remaining set values
(the merge-field semantics of mergeOn)
*/
export function processMergeRow(
  row: Record<string, unknown>,
  schema: EntitySchema,
): { match: Record<string, unknown>; set: Record<string, unknown> } {
  const mergeFields = getMergeFields(schema)
  const mergeKeys = new Set(mergeFields.map((property) => property.getKey()))

  // Match only on explicitly set merge fields: default-resolving them
  // (e.g. a fresh UUID per row) would never match anything
  const match: Record<string, unknown> = {}

  for (const property of mergeFields) {
    const key = property.getKey()

    if (Object.hasOwn(row, key) && row[key] !== undefined) {
      match[key] = row[key]
    }
  }

  if (Object.keys(match).length === 0) {
    throw new Error(
      'mergeMany requires every row to set at least one merge field ' +
        `(unique, indexed or primary key properties): ${mergeFields
          .map((property) => property.getKey())
          .join(', ')}`,
    )
  }

  const set: Record<string, unknown> = {}

  for (const property of schema.getProperties()) {
    if (NON_WRITABLE_TYPES.has(property.getType()) || isProjectedProperty(property)) {continue}

    // Match keys ride in the match map; they must never be
    // default-resolved into the set map
    if (mergeKeys.has(property.getKey())) {continue}

    const value = getValueOrDefault(row, property, schema)

    if (value !== undefined) {
      set[property.getKey()] = value
    }
  }

  validate({ ...match, ...set }, schema)

  return { match, set }
}

/**
UNWIND $rows AS row
CREATE (this:Label)
SET this += row
RETURN this
*/
export function buildCreateQuery(labels: string[]): string {
  return [
    'UNWIND $rows AS row',
    `CREATE (${THIS_NODE}${labelPattern(labels)})`,
    `SET ${THIS_NODE} += row`,
    `RETURN ${THIS_NODE}`,
  ].join('\n')
}

/**
UNWIND $rows AS row
MERGE (this:Label { key: row.key, ... })
SET this += row
RETURN this
*/
export function buildMergeQuery(labels: string[], matchKeys: string[]): string {
  if (matchKeys.length === 0) {
    throw new Error('mergeMany requires at least one match property')
  }

  const pattern = matchKeys.map((key) => `${key}: row.${key}`).join(', ')

  return [
    'UNWIND $rows AS row',
    `MERGE (${THIS_NODE}${labelPattern(labels)} { ${pattern} })`,
    `SET ${THIS_NODE} += row`,
    `RETURN ${THIS_NODE}`,
  ].join('\n')
}

/**
Run one unit of work per chunk: a managed WRITE transaction when the
runner is a ConnectionProvider, or the runner's own scope when it is an
already-open transaction
*/
async function inWriteTransaction(
  runner: Runner,
  database: string | undefined,
  work: (tx: Runner) => Promise<QueryOutput>,
): Promise<QueryOutput> {
  const provider = runner as ConnectionProvider

  if (typeof provider.beginTransaction !== 'function') {
    return work(runner)
  }

  const tx = await provider.beginTransaction('WRITE', database)

  try {
    const output = await work(tx)

    await tx.commit()

    return output
  } catch (error) {
    await tx.rollback().catch(() => {})

    throw error
  }
}

/**
Bulk CREATE and MERGE via UNWIND: one managed write transaction per
chunk, one UNWIND statement per transaction, rows validated and reduced
to property maps exactly like the single-create / merge paths
*/
export default class BulkService extends QueryService {
  /**
  CREATE every row in chunks. Rows are flat property records: nested
  relationship targets are not supported (they throw), defaults and
  validation behave exactly like create()
  */
  async createMany<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    rows: Record<string, unknown>[],
    options: BulkOptions = {},
  ): Promise<BulkChunk<T>[]> {
    const rowMaps = rows.map((row) => processCreateRow(row, schema))

    return this.writeChunks<T>(constructor, rowMaps, buildCreateQuery(schema.getLabels()), options)
  }

  /**
  MERGE every row in chunks on the model's merge fields (the unique,
  indexed or primary key properties each row explicitly sets): rows
  matching an existing node update it (`+=`), the rest are created.
  Every row must merge on the same merge fields
  */
  async mergeMany<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    rows: Record<string, unknown>[],
    options: BulkOptions = {},
  ): Promise<BulkChunk<T>[]> {
    if (rows.length === 0) {
      return []
    }

    const parts = rows.map((row) => processMergeRow(row, schema))

    const firstPart = parts[0]

    if (firstPart === undefined) {
      return []
    }

    const matchKeys = Object.keys(firstPart.match).sort()

    for (const [index, part] of parts.entries()) {
      const keys = Object.keys(part.match).sort()

      if (keys.join(',') !== matchKeys.join(',')) {
        throw new Error(
          `mergeMany requires every row to merge on the same merge fields: ` +
            `row 0 merges on ${matchKeys.join(', ')}, row ${index} on ${keys.join(', ')}`,
        )
      }
    }

    const query = buildMergeQuery(schema.getLabels(), matchKeys)

    // The MERGE pattern reads the match values off the row map
    const rowMaps = parts.map((part) => ({ ...part.set, ...part.match }))

    return this.writeChunks<T>(constructor, rowMaps, query, options)
  }

  private async writeChunks<T>(
    constructor: new (...arguments_: never[]) => T,
    rowMaps: Record<string, unknown>[],
    query: string,
    options: BulkOptions,
  ): Promise<BulkChunk<T>[]> {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE

    const chunks: BulkChunk<T>[] = []

    for (const rows of chunk(rowMaps, chunkSize)) {
      const output = await inWriteTransaction(this.runner, options.database, async (tx) =>
        tx.run(query, { rows }),
      )

      chunks.push({
        count: rows.length,
        entities: hydrate<T>(constructor, output, THIS_NODE),
      })
    }

    return chunks
  }
}
