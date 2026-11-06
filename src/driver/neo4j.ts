import {
  type Driver,
  type Node as DriverNode,
  type Record as DriverRecord,
  type Relationship as DriverRelationship,
  type Session as DriverSession,
  session as DriverSessionMode,
  type Transaction as DriverTransaction,
  Integer as DriverInteger,
  DateTime as DriverDateTime,
  Date as DriverDate,
  Time as DriverTime,
  LocalTime as DriverLocalTime,
  LocalDateTime as DriverLocalDateTime,
  Point as DriverPoint,
  Duration as DriverDuration,
} from 'neo4j-driver'

import type {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams as QueryParameters,
  QueryRecord,
  TransactionHandle,
} from './types.js'
import { classifyError } from '../errors/index.js'

/**
Walk a driver result value and normalize driver-specific types
(Node, Relationship, Integer, temporal, point) into plain JS shapes.
*/
export function normalizeDriverValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // Integers are natively represented in driver 5+, but the type can still
  // appear when lossless integers are enabled — convert defensively.
  if (DriverInteger.isInteger(value)) {
    return (value).toNumber()
  }

  if (isDriverNode(value)) {
    return {
      elementId: value.elementId,
      labels: value.labels,
      properties: normalizeDriverValue(value.properties) as Record<string, unknown>,
    }
  }

  if (isDriverRelationship(value)) {
    return {
      elementId: value.elementId,
      type: value.type,
      startElementId: value.startNodeElementId,
      endElementId: value.endNodeElementId,
      properties: normalizeDriverValue(value.properties) as Record<string, unknown>,
    }
  }

  // Temporal / spatial types expose a toString that round-trips the value;
  // they are passed through as-is for now (deep value mapping lands with
  // the property-type layer) but their internal integers are normalized.
  if (
    value instanceof DriverDateTime ||
    value instanceof DriverDate ||
    value instanceof DriverTime ||
    value instanceof DriverLocalTime ||
    value instanceof DriverLocalDateTime ||
    value instanceof DriverDuration ||
    value instanceof DriverPoint
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDriverValue(item))
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = normalizeDriverValue(item)
    }

    return output
  }

  return value
}

function isDriverNode(value: unknown): value is DriverNode {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as DriverNode).elementId === 'string' &&
    Array.isArray((value as DriverNode).labels) &&
    typeof (value as DriverNode).properties === 'object'
  )
}

function isDriverRelationship(value: unknown): value is DriverRelationship {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as DriverRelationship).elementId === 'string' &&
    typeof (value as DriverRelationship).type === 'string' &&
    typeof (value as DriverRelationship).startNodeElementId === 'string'
  )
}

class DriverQueryRecord implements QueryRecord {
  private readonly record: DriverRecord

  constructor(record: DriverRecord) {
    this.record = record
  }

  get(key: string): unknown {
    return normalizeDriverValue(this.record.get(key))
  }

  has(key: string): boolean {
    return this.record.has(key)
  }

  get keys(): string[] {
    return this.record.keys as string[]
  }
}

export class Neo4jTransactionHandle implements TransactionHandle {
  private readonly session: DriverSession
  private readonly tx: DriverTransaction

  constructor(session: DriverSession, tx: DriverTransaction) {
    this.session = session
    this.tx = tx
  }

  async run(statement: string, parameters?: QueryParameters): Promise<QueryOutput> {
    try {
      const result = await this.tx.run(statement, parameters)

      return { records: result.records.map((record) => new DriverQueryRecord(record)) }
    } catch (error) {
      throw classifyError(error)
    }
  }

  async commit(): Promise<void> {
    await this.tx.commit()
    await this.session.close()
  }

  async rollback(): Promise<void> {
    await this.tx.rollback()
    await this.session.close()
  }
}

export class Neo4jConnectionProvider implements ConnectionProvider {
  private readonly driver: Driver
  private readonly database: string | undefined

  constructor(driver: Driver, database?: string) {
    this.driver = driver
    this.database = database
  }

  private async session(mode: AccessMode, database?: string): Promise<DriverSession> {
    const sessionDatabase = database ?? this.database

    return this.driver.session({
      ...(sessionDatabase === undefined ? {} : { database: sessionDatabase }),
      defaultAccessMode: mode === 'READ' ? DriverSessionMode.READ : DriverSessionMode.WRITE,
    })
  }

  async run(
    statement: string,
    parameters?: QueryParameters,
    mode: AccessMode = 'WRITE',
    database?: string,
  ): Promise<QueryOutput> {
    const session = await this.session(mode, database)

    try {
      const result = await session.run(statement, parameters)

      return {
        records: result.records.map((record) => new DriverQueryRecord(record)),
        summary: {
          counters: result.summary.counters
            ? Object.fromEntries(
                Object.entries(result.summary.counters.updates()).filter(([, value]) => value > 0),
              )
            : {},
          // Populated by EXPLAIN / PROFILE statements (query options
          // are not used; the keywords prefix the statement itself)
          plan: result.summary.plan,
          profile: result.summary.profile,
        },
      }
    } catch (error) {
      throw classifyError(error)
    } finally {
      await session.close()
    }
  }

  async beginTransaction(
    mode: AccessMode = 'WRITE',
    database?: string,
  ): Promise<TransactionHandle> {
    try {
      const session = await this.session(mode, database)
      const tx = session.beginTransaction()

      return new Neo4jTransactionHandle(session, tx)
    } catch (error) {
      throw classifyError(error)
    }
  }

  async edition(): Promise<'enterprise' | 'community' | 'unknown'> {
    try {
      const output = await this.run('CALL dbms.components() YIELD edition RETURN edition')

      const value = output.records[0]?.get('edition')

      return value === 'enterprise' ? 'enterprise' : (value === 'community' ? 'community' : 'unknown')
    } catch {
      return 'unknown'
    }
  }

  async close(): Promise<void> {
    await this.driver.close()
  }
}
