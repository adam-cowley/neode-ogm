import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import type {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams as QueryParameters,
  QueryRecord,
  TransactionHandle,
} from './types.js'

/**
Client shapes from the embedded Relate engine (@relate/relate).
Kept as structural types so the client stays a soft dependency.
*/
type RelateResultRow = Record<string, unknown>;

interface RelateResult {
  columns: string[]
  rows: RelateResultRow[]
  stats: Record<string, number>
}

interface RelateConnection {
  queryAsync(cypher: string, parameters?: Record<string, unknown>): Promise<RelateResult>
  query(cypher: string, parameters?: Record<string, unknown>): RelateResult
  begin(): void
  commit(): string | null
  rollback(): void
}

interface RelateDatabase {
  connect(namespace?: string): RelateConnection
  checkpoint(): void
}

interface RelateNodeValue {
  kind: 'node'
  elementId: string
  id: bigint | number
  labels: string[]
  properties: Record<string, unknown>
}

interface RelateRelationshipValue {
  kind: 'relationship'
  elementId: string
  type: string
  startElementId: string
  endElementId: string
  properties: Record<string, unknown>
}

/**
Resolve the Relate client module and native library.

The client is not yet published to npm, so it is loaded from disk:
  1. `RELATE_CLIENT_PATH` env var, or
  2. the sibling `relate` repository checkout (`../relate/clients/javascript`)

The native library location is passed through via `RELATE_LIB`
(see the Relate client's loader) — detected automatically here when
a sibling repository checkout exists.
*/
export function requireRelateClient(): RelateClientModule {
  if (!process.env['RELATE_LIB']) {
    for (const dir of ['release', 'debug']) {
      const candidate = resolveSiblingRepositoryLibrary(dir)

      if (candidate) {
        process.env['RELATE_LIB'] = candidate
        break
      }
    }
  }

  // createRequire keeps the client a soft dependency: it is resolved at call
  // time (not import time) from node_modules or a sibling checkout
  const nodeRequire = createRequire(import.meta.url)

  try {
    return nodeRequire('@relate/relate') as RelateClientModule
  } catch {
    const sibling = resolveSiblingRepositoryClient()

    if (sibling) {
      return nodeRequire(sibling) as RelateClientModule
    }

    throw new Error(
      'The Relate client could not be loaded. Install it into ../relate ' +
        '(git clone https://github.com/relatedb/relate && cargo build -p relate-ffi --release), ' +
        'or point RELATE_CLIENT_PATH / RELATE_LIB at a working build.',
    )
  }
}

interface RelateClientModule {
  Database: {
    open(uri: string, options?: { readOnly?: boolean }): RelateDatabase
  }
}

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url))
}

function resolveSiblingRepositoryClient(): string | null {
  const candidates = [
    process.env['RELATE_CLIENT_PATH'],
    path.resolve(moduleDir(), '../../../relate/clients/javascript'),
    path.resolve(moduleDir(), '../../../../relate/clients/javascript'),
  ].filter((candidate): candidate is string => !!candidate)

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.js'))) {
      return candidate
    }
  }

  return null
}

function resolveSiblingRepositoryLibrary(profile: string): string | null {
  const candidates = [
    path.resolve(moduleDir(), '../../../relate'),
    path.resolve(moduleDir(), '../../../../relate'),
  ]

  for (const repository of candidates) {
    for (const extension of ['dylib', 'so']) {
      const candidate = path.join(repository, 'target', profile, `librelate_ffi.${extension}`)

      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  return null
}

class RelateQueryRecord implements QueryRecord {
  private readonly columns: string[]
  private readonly row: RelateResultRow

  constructor(columns: string[], row: RelateResultRow) {
    this.columns = columns
    this.row = row
  }

  get(key: string): unknown {
    return normalizeRelateValue(this.row[key])
  }

  has(key: string): boolean {
    return this.columns.includes(key)
  }

  get keys(): string[] {
    return this.columns
  }
}

/**
Convert Relate values into the normalized graph shapes. Nodes and
relationships arrive as plain objects with a `kind` discriminator.
*/
export function normalizeRelateValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>

    if (object['kind'] === 'node') {
      const node = value as RelateNodeValue

      return {
        elementId: node.elementId,
        labels: node.labels,
        properties: normalizeRelateValue(node.properties) as Record<string, unknown>,
      }
    }

    if (object['kind'] === 'relationship') {
      const rel = value as RelateRelationshipValue

      return {
        elementId: rel.elementId,
        type: rel.type,
        startElementId: rel.startElementId,
        endElementId: rel.endElementId,
        properties: normalizeRelateValue(rel.properties) as Record<string, unknown>,
      }
    }

    const output: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(object)) {
      output[key] = normalizeRelateValue(item)
    }

    return output
  }

  return Array.isArray(value) ? value.map((item) => normalizeRelateValue(item)) : value;
}

import { classifyError } from '../errors/index.js'

/**
The Relate JS client rejects with RelateError carrying the Neo4j error
code — classify it into the taxonomy (NTS-129) so both backends surface
typed errors
*/
async function classified<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw classifyError(error)
  }
}

class RelateTransactionHandle implements TransactionHandle {
  private open = true

  private readonly connection: RelateConnection
  private readonly release: () => void = () => {}

  constructor(connection: RelateConnection, release?: () => void) {
    this.connection = connection
    this.release = release ?? (() => {})
  }

  async run(statement: string, parameters?: QueryParameters): Promise<QueryOutput> {
    if (!this.open) {
      throw new Error('Transaction has already been closed')
    }

    const result = await classified(this.connection.queryAsync(statement, parameters))

    return {
      records: result.rows.map((row) => new RelateQueryRecord(result.columns, row)),
      summary: { counters: result.stats },
    }
  }

  async commit(): Promise<void> {
    if (!this.open) {
      return
    }

    this.open = false

    try {
      this.connection.commit()
    } catch (error) {
      throw classifyError(error)
    }

    this.release()
  }

  async rollback(): Promise<void> {
    if (!this.open) {
      return
    }

    this.open = false

    try {
      this.connection.rollback()
    } catch (error) {
      throw classifyError(error)
    }

    this.release()
  }
}

export class RelateConnectionProvider implements ConnectionProvider {
  private readonly connection: RelateConnection

  /**
  The embedded engine supports ONE transaction at a time per connection.
  Facade flows run concurrently (e.g. Promise.all of saves), so
  beginTransaction serialises: each transaction holds the slot from
  begin() until its commit/rollback.
  */
  private queue: Promise<void> = Promise.resolve()
  private txOpen = false

  constructor(database: RelateDatabase, namespace = 'neo4j') {
    const client = requireRelateClient()
    client // the native library is loaded at require-time

    this.connection = database.connect(namespace)
  }

  /**
  The embedded engine runs in a single namespace, fixed when the provider
  is constructed (`namespace`): the per-call `database` override and the
  access mode are accepted for port parity and ignored.
  */
  async run(
    statement: string,
    parameters?: QueryParameters,
    _mode?: AccessMode,
    _database?: string,
  ): Promise<QueryOutput> {
    if (this.txOpen) {
      throw new Error(
        "A transaction is open on this connection: use the transaction's own " +
          'methods for statements that belong to it, or commit/rollback first',
      )
    }

    const result = await classified(this.connection.queryAsync(statement, parameters))

    return {
      records: result.rows.map((row) => new RelateQueryRecord(result.columns, row)),
      summary: { counters: result.stats },
    }
  }

  async beginTransaction(
    _mode: AccessMode = 'WRITE',
    _database?: string,
  ): Promise<TransactionHandle> {
    const previous = this.queue

    let release!: () => void
    this.queue = new Promise<void>((resolve) => (release = resolve))

    await previous

    this.txOpen = true
    this.connection.begin()

    return new RelateTransactionHandle(this.connection, () => {
      this.txOpen = false
      release()
    })
  }

  async edition(): Promise<'enterprise' | 'community' | 'unknown'> {
    // The embedded engine has no editions
    return 'community'
  }

  async close(): Promise<void> {
    // The connection is owned by the database instance
  }
}
