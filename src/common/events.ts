/**
 * Lifecycle events emitted by Neode (facade) and TransactionalService (work
 * performed inside an open transaction).
 *
 * Subscribe with `neode.on(EventType.NODE_CREATED, handler)`, unsubscribe with
 * `neade.off(...)`. Handlers receive the affected value as their only
 * argument:
 *
 * | Event                  | Emitted by                          | Payload            |
 * |------------------------|-------------------------------------|--------------------|
 * | NODE_CREATED           | create(), save()                    | hydrated entity    |
 * | NODE_MERGED            | reserved (mergeOn)                  | —                  |
 * | NODE_UPDATED           | reserved (update)                   | —                  |
 * | NODE_DELETED           | delete()                            | deleted entity     |
 * | RELATIONSHIP_CREATED   | relate() with forceCreate           | GraphRelationship  |
 * | RELATIONSHIP_MERGED    | relate() (MERGE, the default)       | GraphRelationship  |
 * | RELATIONSHIP_UPDATED   | reserved                            | —                  |
 * | RELATIONSHIP_DELETED   | reserved (detach)                   | —                  |
 * | QUERY_EXECUTED         | every statement run through the     | QueryExecutedEvent |
 * |                        | instance's connection (raw +        |                    |
 * |                        | service queries, inside and outside |                    |
 * |                        | transactions)                       |                    |
 *
 * Events are emitted synchronously on an EventEmitter scoped to the Neode
 * instance.
 */
export enum EventType {
  NODE_CREATED = 'node:created',
  NODE_MERGED = 'node:merged',
  NODE_UPDATED = 'node:updated',
  NODE_DELETED = 'node:deleted',
  RELATIONSHIP_CREATED = 'relationship:created',
  RELATIONSHIP_MERGED = 'relationship:merged',
  RELATIONSHIP_UPDATED = 'relationship:updated',
  RELATIONSHIP_DELETED = 'relationship:deleted',
  QUERY_EXECUTED = 'query:executed',
}

/** Payload of QUERY_EXECUTED, emitted once per executed statement. */
export interface QueryExecutedEvent {
  /** The statement that ran */
  cypher: string
  /** The statement parameters */
  params: Record<string, unknown>
  /** Wall-clock duration in milliseconds */
  duration: number
  /** Resolved database (undefined = the server's default) */
  database?: string
}

/** Handler for a lifecycle event; the payload shape depends on the event. */
export type NeodeEventHandler = (payload: unknown) => void
