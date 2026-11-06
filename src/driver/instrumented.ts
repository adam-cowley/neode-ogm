import { QueryExecutedEvent } from '../common/events';
import { AccessMode, ConnectionProvider, QueryOutput, QueryParams, TransactionHandle } from './types';

/** Listener invoked once per executed statement — successful or not. */
export type QueryExecutedListener = (event: QueryExecutedEvent) => void;

function instrumentRun(
    run: (statement: string, parameters?: QueryParams) => Promise<QueryOutput>,
    onQuery: QueryExecutedListener,
    database?: string
): (statement: string, parameters?: QueryParams) => Promise<QueryOutput> {
    return async (statement, parameters) => {
        const start = performance.now();

        try {
            return await run(statement, parameters);
        } finally {
            onQuery({
                cypher: statement,
                params: parameters ?? {},
                duration: performance.now() - start,
                database,
            });
        }
    };
}

/**
 * A ConnectionProvider forwarding to `inner` and reporting every executed
 * statement — implicit and inside transactions — to `onQuery`. This is the
 * shared runner chokepoint the `query:executed` lifecycle event emits from.
 */
export class InstrumentedConnectionProvider implements ConnectionProvider {
    constructor(
        private readonly inner: ConnectionProvider,
        private readonly onQuery: QueryExecutedListener
    ) {}

    run(
        statement: string,
        parameters?: QueryParams,
        mode?: AccessMode,
        database?: string
    ): Promise<QueryOutput> {
        return instrumentRun(
            (cypher, params) => this.inner.run(cypher, params, mode, database),
            this.onQuery,
            database
        )(statement, parameters);
    }

    async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
        const handle = await this.inner.beginTransaction(mode, database);

        return {
            run: instrumentRun(
                (statement, parameters) => handle.run(statement, parameters),
                this.onQuery,
                database
            ),
            commit: () => handle.commit(),
            rollback: () => handle.rollback(),
        };
    }

    edition(): Promise<'enterprise' | 'community' | 'unknown'> {
        return this.inner.edition();
    }

    close(): Promise<void> {
        return this.inner.close();
    }
}

/**
 * Instrument a provider transparently: property reads the wrapper doesn't
 * satisfy — duck-typed introspection such as `connection.database` on the
 * neo4j provider — forward to the inner provider, so consumers holding
 * `Neode#getConnection()` see through the instrumentation.
 */
export function instrumentConnectionProvider(
    inner: ConnectionProvider,
    onQuery: QueryExecutedListener
): ConnectionProvider {
    return new Proxy(new InstrumentedConnectionProvider(inner, onQuery), {
        get(target, property, receiver) {
            if (property in target) {
                return Reflect.get(target, property, receiver);
            }

            return Reflect.get(inner as object, property, receiver);
        },
    });
}
