import {
    AccessMode,
    ConnectionProvider,
    QueryOutput,
    QueryParams,
    QueryRecord,
    TransactionHandle,
} from './types';

/**
 * Client shapes from the embedded Relate engine (@relate/relate).
 * Kept as structural types so the client stays a soft dependency.
 */
interface RelateResultRow {
    [column: string]: unknown;
}

interface RelateResult {
    columns: string[];
    rows: RelateResultRow[];
    stats: Record<string, number>;
}

interface RelateConnection {
    queryAsync(cypher: string, params?: Record<string, unknown>): Promise<RelateResult>;
    query(cypher: string, params?: Record<string, unknown>): RelateResult;
    begin(): void;
    commit(): string | null;
    rollback(): void;
}

interface RelateDatabase {
    connect(namespace?: string): RelateConnection;
    checkpoint(): void;
}

interface RelateNodeValue {
    kind: 'node';
    elementId: string;
    id: bigint | number;
    labels: string[];
    properties: Record<string, unknown>;
}

interface RelateRelationshipValue {
    kind: 'relationship';
    elementId: string;
    type: string;
    startElementId: string;
    endElementId: string;
    properties: Record<string, unknown>;
}

/**
 * Resolve the Relate client module and native library.
 *
 * The client is not yet published to npm, so it is loaded from disk:
 *   1. `RELATE_CLIENT_PATH` env var, or
 *   2. the sibling `relate` repository checkout (`../relate/clients/javascript`)
 *
 * The native library location is passed through via `RELATE_LIB`
 * (see the Relate client's loader) — detected automatically here when
 * a sibling repository checkout exists.
 */
export function requireRelateClient(): RelateClientModule {
    if (!process.env.RELATE_LIB) {
        for (const dir of ['release', 'debug']) {
            const candidate = resolveSiblingRepoLibrary(dir);

            if (candidate) {
                process.env.RELATE_LIB = candidate;
                break;
            }
        }
    }

    try {
        return require('@relate/relate');
    } catch {
        const sibling = resolveSiblingRepoClient();

        if (sibling) {
            return require(sibling);
        }

        throw new Error(
            'The Relate client could not be loaded. Install it into ../relate ' +
                '(git clone https://github.com/relatedb/relate && cargo build -p relate-ffi --release), ' +
                'or point RELATE_CLIENT_PATH / RELATE_LIB at a working build.'
        );
    }
}

interface RelateClientModule {
    Database: {
        open(uri: string, options?: { readOnly?: boolean }): RelateDatabase;
    };
}

function resolveSiblingRepoClient(): string | null {
    const path = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');

    const candidates = [
        process.env.RELATE_CLIENT_PATH,
        path.resolve(__dirname, '../../../relate/clients/javascript'),
        path.resolve(__dirname, '../../../../relate/clients/javascript'),
    ].filter((candidate): candidate is string => !!candidate);

    for (const candidate of candidates) {
        if (fs.existsSync(require('path').join(candidate, 'index.js'))) {
            return candidate;
        }
    }

    return null;
}

function resolveSiblingRepoLibrary(profile: string): string | null {
    const path = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');

    const candidates = [
        path.resolve(__dirname, '../../../relate'),
        path.resolve(__dirname, '../../../../relate'),
    ];

    for (const repo of candidates) {
        for (const extension of ['dylib', 'so']) {
            const candidate = path.join(repo, 'target', profile, `librelate_ffi.${extension}`);

            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

class RelateQueryRecord implements QueryRecord {
    constructor(
        private readonly columns: string[],
        private readonly row: RelateResultRow
    ) {}

    get(key: string): unknown {
        return normalizeRelateValue(this.row[key]);
    }

    has(key: string): boolean {
        return this.columns.includes(key);
    }

    get keys(): string[] {
        return this.columns;
    }
}

/**
 * Convert Relate values into the normalized graph shapes. Nodes and
 * relationships arrive as plain objects with a `kind` discriminator.
 */
export function normalizeRelateValue(value: unknown): unknown {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;

        if (object.kind === 'node') {
            const node = value as RelateNodeValue;

            return {
                elementId: node.elementId,
                labels: node.labels,
                properties: normalizeRelateValue(node.properties) as Record<string, unknown>,
            };
        }

        if (object.kind === 'relationship') {
            const rel = value as RelateRelationshipValue;

            return {
                elementId: rel.elementId,
                type: rel.type,
                startElementId: rel.startElementId,
                endElementId: rel.endElementId,
                properties: normalizeRelateValue(rel.properties) as Record<string, unknown>,
            };
        }

        const output: Record<string, unknown> = {};

        for (const [key, item] of Object.entries(object)) {
            output[key] = normalizeRelateValue(item);
        }

        return output;
    }

    if (Array.isArray(value)) {
        return value.map((item) => normalizeRelateValue(item));
    }

    return value;
}

class RelateTransactionHandle implements TransactionHandle {
    private open = true;

    constructor(
        private readonly connection: RelateConnection,
        private readonly release: () => void = () => {}
    ) {}

    async run(statement: string, parameters?: QueryParams): Promise<QueryOutput> {
        if (!this.open) {
            throw new Error('Transaction has already been closed');
        }

        const result = await this.connection.queryAsync(statement, parameters);

        return {
            records: result.rows.map(
                (row) => new RelateQueryRecord(result.columns, row)
            ),
            summary: { counters: result.stats },
        };
    }

    async commit(): Promise<void> {
        if (!this.open) {
            return;
        }

        this.open = false;
        this.connection.commit();
        this.release();
    }

    async rollback(): Promise<void> {
        if (!this.open) {
            return;
        }

        this.open = false;
        this.connection.rollback();
        this.release();
    }
}

export class RelateConnectionProvider implements ConnectionProvider {
    private readonly connection: RelateConnection;

    /**
     * The embedded engine supports ONE transaction at a time per connection.
     * Facade flows run concurrently (e.g. Promise.all of saves), so
     * beginTransaction serialises: each transaction holds the slot from
     * begin() until its commit/rollback.
     */
    private queue: Promise<void> = Promise.resolve();
    private txOpen = false;

    constructor(database: RelateDatabase, namespace = 'neo4j') {
        const client = requireRelateClient();
        void client; // the native library is loaded at require-time

        this.connection = database.connect(namespace);
    }

    /**
     * The embedded engine runs in a single namespace, fixed when the provider
     * is constructed (`namespace`): the per-call `database` override and the
     * access mode are accepted for port parity and ignored.
     */
    async run(
        statement: string,
        parameters?: QueryParams,
        _mode?: AccessMode,
        _database?: string
    ): Promise<QueryOutput> {
        if (this.txOpen) {
            throw new Error(
                'A transaction is open on this connection: use the transaction\'s own ' +
                    'methods for statements that belong to it, or commit/rollback first'
            );
        }

        const result = await this.connection.queryAsync(statement, parameters);

        return {
            records: result.rows.map((row) => new RelateQueryRecord(result.columns, row)),
            summary: { counters: result.stats },
        };
    }

    async beginTransaction(_mode: AccessMode = 'WRITE', _database?: string): Promise<TransactionHandle> {
        const previous = this.queue;

        let release!: () => void;
        this.queue = new Promise<void>((resolve) => (release = resolve));

        await previous;

        this.txOpen = true;
        this.connection.begin();

        return new RelateTransactionHandle(this.connection, () => {
            this.txOpen = false;
            release();
        });
    }

    async edition(): Promise<'enterprise' | 'community' | 'unknown'> {
        // The embedded engine has no editions
        return 'community';
    }

    async close(): Promise<void> {
        // The connection is owned by the database instance
    }
}
