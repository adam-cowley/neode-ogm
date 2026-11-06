import Match from './Match';
import Order from './Order';
import Property from './Property';
import Relationship from './Relationship';
import Statement from './Statement';
import Where, { OPERATOR_EQUALS } from './Where';
import WhereBetween from './WhereBetween';
import WhereId from './WhereId';
import WhereRaw from './WhereRaw';
import WhereStatement from './WhereStatement';
import { Direction } from './Direction';
import WithDistinctStatement from './WithDistinctStatement';
import WithStatement from './WithStatement';
import { AccessMode, ConnectionProvider, QueryOutput, Runner } from '../driver/types';

export const mode = {
    READ: 'READ',
    WRITE: 'WRITE',
} as const;

export type BuilderParams = Record<string, unknown>;

type WhereArgs = [left: string, operator: string, value: unknown] | [left: string, value: unknown];

/**
 * Fluent Cypher query builder.
 *
 * A statement-based builder: every `match()` / `create()` / `merge()` call
 * starts a new statement segment; where clauses accumulate against the
 * current segment and are flushed into it when the next segment starts or
 * when `build()` is called.
 *
 * All user values are passed as query parameters - the generated query
 * contains only aliases.
 */
export default class Builder {
    private readonly params: BuilderParams = {};
    private readonly statements: { toString(includePrefix?: boolean): string }[] = [];

    private current?: Statement;
    private whereClause?: WhereStatement;
    private setCount = 0;

    /**
     * Start a new query segment and set the current statement
     */
    statement(prefix?: string): Builder {
        if (this.current) {
            this.statements.push(this.current);
        }

        this.current = new Statement(prefix);

        return this;
    }

    /**
     * Start a new where segment. When a where segment is already open, it is
     * flushed into the current statement first.
     */
    whereStatement(prefix?: string): Builder {
        if (this.whereClause && this.current) {
            this.current.where(this.whereClause.toString());
        }

        this.whereClause = new WhereStatement(prefix);

        return this;
    }

    /**
     * Match a node pattern by alias and optional labels / inline properties
     */
    match(alias?: string, labels?: string | string[] | false, properties?: BuilderParams): Builder {
        this.whereStatement('WHERE');
        this.statement();

        this.current!.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)));

        return this;
    }

    /**
     * Add an optional match to the query
     */
    optionalMatch(alias?: string, labels?: string | string[] | false): Builder {
        this.whereStatement('WHERE');
        this.statement('OPTIONAL MATCH');

        this.current!.match(new Match(alias, labels));

        return this;
    }

    /**
     * Add a `WITH` clause to the query
     */
    with(...variables: string[]): Builder {
        this.whereStatement('WHERE');
        this.statement();

        this.statements.push(new WithStatement(variables));

        return this;
    }

    /**
     * Add a `WITH DISTINCT` clause to the query
     */
    withDistinct(...variables: string[]): Builder {
        this.whereStatement('WHERE');
        this.statement();

        this.statements.push(new WithDistinctStatement(variables));

        return this;
    }

    /**
     * Start an `OR` where clause. Switches the connector used for the next
     * condition appended to the current where segment (creating one if none
     * is open) so that it combines with `OR` instead of `AND`.
     *
     * P2.2 parity (neode Builder#or): neode opens a separate `OR (...)`
     * segment, which renders an invalid leading `OR (` when called before
     * any where condition. Here the connector applies to the next clause
     * inside the single WHERE group instead; Cypher's operator precedence
     * keeps the semantics identical to neode's grouped output.
     */
    or(...args: unknown[]): Builder {
        if (!this.whereClause) {
            this.whereStatement('WHERE');
        }

        this.whereClause!.setConnector('OR');

        return this.where(...(args as WhereArgs));
    }

    /**
     * Generate a unique parameter name and add the value to the params object
     */
    private addParameter(key: string, value: unknown): string {
        let attempt = 1;
        const base = `where_${key.replace(/[^a-z0-9]+/gi, '_')}`;

        let variable = base;

        while (typeof this.params[variable] !== 'undefined') {
            attempt++;
            variable = `${base}_${attempt}`;
        }

        this.params[variable] = value;

        return variable;
    }

    /**
     * Add a where condition to the current statement. Supported forms:
     *
     * - `where('n.name', 'Adam')` - equality
     * - `where('n.age', '>', 30)` - explicit operator
     * - `where({ name: 'Adam' })` - object map
     * - `where([['name', 'Adam'], ['age', '>', 30]])` - array of clauses
     * - `where('n.name =~ ".*"')` - raw string
     */
    where(...args: unknown[]): Builder {
        if (!args.length || !args[0]) {
            return this;
        }

        // Two arguments: property / value equality
        if (args.length === 2) {
            args = [args[0], OPERATOR_EQUALS, args[1]];
        }

        // Single argument: object, array or raw string
        if (args.length === 1) {
            const [arg] = args;

            if (Array.isArray(arg)) {
                arg.forEach((inner) => {
                    this.where(...(inner as unknown[]));
                });
            } else if (typeof arg === 'object') {
                Object.keys(arg as Record<string, unknown>).forEach((key) => {
                    this.where(key, (arg as Record<string, unknown>)[key]);
                });
            } else {
                this.whereRaw(String(arg));
            }
        } else {
            const [left, operator, value] = args as [string, string, unknown];
            const variable = this.addParameter(left, value);

            this.whereClause!.append(new Where(left, operator, `$${variable}`));
        }

        return this;
    }

    /**
     * Query on element ID
     */
    whereId(alias: string, value: string | number): Builder {
        const variable = this.addParameter(`${alias}_id`, value);

        this.whereClause!.append(new WhereId(alias, variable));

        return this;
    }

    /**
     * Add a raw where clause
     */
    whereRaw(clause: string): Builder {
        this.whereClause!.append(new WhereRaw(clause));

        return this;
    }

    /**
     * Negate the previous where condition
     */
    whereNot(...args: unknown[]): Builder {
        this.where(...args);

        const last = this.whereClause!.last();

        if (last && typeof (last as Where).setNegative === 'function') {
            (last as Where).setNegative();
        }

        return this;
    }

    /**
     * Between clause: `$floor <= alias <= $ceiling`
     */
    whereBetween(alias: string, floor: unknown, ceiling: unknown): Builder {
        const floorVariable = this.addParameter(`${alias}_floor`, floor);
        const ceilingVariable = this.addParameter(`${alias}_ceiling`, ceiling);

        this.whereClause!.append(new WhereBetween(alias, floorVariable, ceilingVariable));

        return this;
    }

    /**
     * Negative between clause
     */
    whereNotBetween(alias: string, floor: unknown, ceiling: unknown): Builder {
        this.whereBetween(alias, floor, ceiling);

        const last = this.whereClause!.last();

        if (last && typeof (last as WhereBetween).setNegative === 'function') {
            (last as WhereBetween).setNegative();
        }

        return this;
    }

    /**
     * Add a `DELETE` clause
     */
    delete(...values: string[]): Builder {
        this.current!.delete(...values);

        return this;
    }

    /**
     * Add a `DETACH DELETE` clause
     */
    detachDelete(...values: string[]): Builder {
        this.current!.detachDelete(...values);

        return this;
    }

    /**
     * Start a `CREATE` statement
     */
    create(alias: string, labels?: string | string[] | false, properties?: BuilderParams): Builder {
        this.whereStatement('WHERE');
        this.statement('CREATE');

        this.current!.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)));

        return this;
    }

    /**
     * Convert a map of properties into inline pattern properties,
     * adding each value to the query parameters
     */
    private convertPropertyMap(alias: string | undefined, properties?: BuilderParams): Property[] {
        if (properties) {
            return Object.keys(properties).map((key) => {
                const propertyAlias = `${alias}_${key}`;

                this.params[propertyAlias] = properties[key];

                return new Property(key, propertyAlias);
            });
        }

        return [];
    }

    /**
     * Start a `MERGE` statement
     */
    merge(alias: string, labels?: string | string[] | false, properties?: BuilderParams): Builder {
        this.whereStatement('WHERE');
        this.statement('MERGE');

        this.current!.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)));

        return this;
    }

    /**
     * Set a property. Supported forms:
     *
     * - `set('n.name', 'Adam')` - parameterised set
     * - `set('n.age', 30, '+=')` - explicit operator
     * - `set({ 'n.name': 'Adam' })` - map of properties
     * - `set('n.age = n.age + 1', undefined)` - raw set
     */
    set(property: string | Record<string, unknown>, value?: unknown, operator: string = '='): Builder {
        if (value === undefined && property instanceof Object) {
            Object.keys(property).forEach((key) => {
                this.set(key, property[key]);
            });
        } else {
            if (value !== undefined) {
                const alias = `set_${this.setCount}`;
                this.params[alias] = value;
                this.setCount++;

                this.current!.set(property as string, alias, operator);
            } else {
                this.current!.setRaw([property as string]);
            }
        }

        return this;
    }

    /**
     * Set a property only on `ON CREATE SET`
     */
    onCreateSet(
        property: string | Record<string, unknown>,
        value?: unknown,
        operator: string = '='
    ): Builder {
        if (value === undefined && property instanceof Object) {
            Object.keys(property).forEach((key) => {
                this.onCreateSet(key, property[key]);
            });
        } else {
            const alias = `set_${this.setCount}`;
            this.params[alias] = value;
            this.setCount++;

            this.current!.onCreateSet(property as string, alias, operator);
        }

        return this;
    }

    /**
     * Set a property only on `ON MATCH SET`
     */
    onMatchSet(
        property: string | Record<string, unknown>,
        value?: unknown,
        operator: string = '='
    ): Builder {
        if (value === undefined && property instanceof Object) {
            Object.keys(property).forEach((key) => {
                this.onMatchSet(key, property[key]);
            });
        } else {
            const alias = `set_${this.setCount}`;
            this.params[alias] = value;
            this.setCount++;

            this.current!.onMatchSet(property as string, alias, operator);
        }

        return this;
    }

    /**
     * Remove properties or labels, in `n.prop` or `n:Label` format
     */
    remove(...items: string[]): Builder {
        this.current!.remove(items);

        return this;
    }

    /**
     * Set return fields / expressions
     */
    return(...values: string[]): Builder {
        this.current!.return(...values);

        return this;
    }

    /**
     * Set the record limit
     */
    limit(limit: number): Builder {
        this.current!.limit(limit);

        return this;
    }

    /**
     * Set records to skip
     */
    skip(skip: number): Builder {
        this.current!.skip(skip);

        return this;
    }

    /**
     * Add an order by clause. Supported forms:
     *
     * - `orderBy('n.name', 'DESC')`
     * - `orderBy('n.name')`
     * - `orderBy(['n.name', 'n.other'])`
     * - `orderBy({ 'n.name': 'DESC' })`
     * - `orderBy({ field: 'n.name', order: 'DESC' })`
     * - `orderBy([{ field: 'n.name', order: 'ASC' }, { field: 'n.other', order: 'DESC' }])`
     */
    orderBy(...args: unknown[]): Builder {
        let order: Order | undefined;

        if (args.length === 2) {
            order = new Order(String(args[0]), String(args[1]));
        } else if (Array.isArray(args[0])) {
            (args[0] as unknown[]).forEach((arg) => this.orderBy(arg));
        } else if (typeof args[0] === 'object' && args[0]) {
            const descriptor = args[0] as { field?: unknown; order?: unknown };

            if (descriptor.field) {
                // P2.2 parity (neode Builder#orderBy): an object carrying a
                // `field` key is a single `{ field, order }` descriptor,
                // not a field -> direction map.
                order = new Order(
                    String(descriptor.field),
                    descriptor.order ? String(descriptor.order) : ''
                );
            } else {
                Object.keys(descriptor as Record<string, unknown>).forEach((key) => {
                    this.orderBy(key, (descriptor as Record<string, unknown>)[key]);
                });
            }
        } else if (args[0]) {
            order = new Order(String(args[0]));
        }

        if (order) {
            this.current!.order(order);
        }

        return this;
    }

    /**
     * Add a relationship pattern to the current statement
     *
     * @param type  Relationship type, or array of types
     * @param direction  Direction of the relationship
     * @param alias  Relationship alias
     * @param degrees  Number of traversals (1, "1..2", "0..2", "..3")
     */
    relationship(
        type?: string | string[],
        direction?: string | Direction,
        alias?: string,
        degrees?: number | string
    ): Builder {
        this.current!.match(new Relationship(type, direction, alias, degrees));

        return this;
    }

    /**
     * Complete a relationship with a target node pattern
     */
    to(alias: string, labels?: string | string[] | false, properties?: BuilderParams): Builder {
        this.current!.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)));

        return this;
    }

    /**
     * Complete a relationship pointing to anything
     */
    toAnything(): Builder {
        this.current!.match(new Match());

        return this;
    }

    /**
     * Build the pattern without any keywords
     */
    pattern(): string {
        this.whereStatement();
        this.statement();

        return this.statements
            .map((statement) => statement.toString(false))
            .filter((statement) => statement.length)
            .join('\n');
    }

    /**
     * Build and run the query against the given runner (neode's
     * Builder#execute): pass `neode.getConnection()` to run it through the
     * connection provider, which honours the READ / WRITE mode
     */
    execute(runner: Runner, mode: AccessMode = 'WRITE'): Promise<QueryOutput> {
        const { query, params } = this.build();

        // A ConnectionProvider routes by mode; a bare Runner ignores the
        // extra argument
        return (runner as ConnectionProvider).run(query, params, mode);
    }

    /**
     * Build the query
     */
    build(): { query: string; params: BuilderParams } {
        this.whereStatement();
        this.statement();

        const query = this.statements
            .map((statement) => statement.toString())
            .filter((statement) => statement.length)
            .join('\n');

        return {
            query,
            params: this.params,
        };
    }
}
