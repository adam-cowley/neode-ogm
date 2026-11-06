/**
 * Database-agnostic interfaces — the port between the OGM and any
 * Cypher-compatible database client.
 *
 * Two implementations ship:
 *  - `Neo4jConnectionProvider` — neo4j-driver over Bolt
 *    (Neo4j Community/Enterprise, Memgraph, Aura, `relate serve`)
 *  - `RelateConnectionProvider` — the embedded Relate engine, in-process
 */

/** A node value in a normalized shape, as returned in result records. */
export interface GraphNode {
    elementId: string;
    labels: string[];
    properties: Record<string, unknown>;
}

/** A relationship value in a normalized shape, as returned in result records. */
export interface GraphRelationship {
    elementId: string;
    type: string;
    startElementId: string;
    endElementId: string;
    properties: Record<string, unknown>;
}

/** One row of a query result. */
export interface QueryRecord {
    get(key: string): unknown;
    has(key: string): boolean;
    readonly keys: string[];
}

/** A query result, independent of the underlying client. */
export interface QueryOutput {
    records: QueryRecord[];
    summary?: QuerySummary;
}

export interface QuerySummary {
    counters?: Record<string, number>;
}

export type QueryParams = Record<string, unknown>;

/** Anything able to run statements in its scope (autocommit or transaction). */
export interface Runner {
    run(statement: string, parameters?: QueryParams): Promise<QueryOutput>;
}

/** An explicit transaction: statements run in scope until commit/rollback. */
export interface TransactionHandle extends Runner {
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

export type AccessMode = 'READ' | 'WRITE';

/** The connection port implemented by every backend. */
export interface ConnectionProvider {
    /** Run a single statement in an implicit transaction. */
    run(
        statement: string,
        parameters?: QueryParams,
        mode?: AccessMode,
        /** Per-call database override — backends with a single namespace ignore it */
        database?: string
    ): Promise<QueryOutput>;

    /** Open an explicit transaction. Remember to commit or rollback. */
    beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle>;

    /** Server edition, if reported: 'enterprise' | 'community' | 'unknown' */
    edition(): Promise<'enterprise' | 'community' | 'unknown'>;

    close(): Promise<void>;
}
