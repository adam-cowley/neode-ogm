export const CONNECTOR_AND = 'AND';
export const CONNECTOR_OR = 'OR';

interface WhereClause {
    toString(): string;
}

export default class WhereStatement {
    private clauses: WhereClause[] = [];

    /**
     * Connector joining each clause to the one before it.
     *
     * P2.2 parity (neode WhereStatement): connectors are tracked per clause
     * rather than for the whole group, so that `where(a).where(b).or(c)`
     * renders `a AND b OR c` - equivalent to neode's grouped
     * `WHERE (a AND b) OR (c)` under Cypher's operator precedence
     * (AND binds tighter than OR) - instead of promoting every join
     * in the group to OR.
     */
    private connectors: string[] = [];
    private nextConnector: string = CONNECTOR_AND;

    constructor(private readonly prefix: string = '') {}

    /**
     * Set the connector used for the next clause appended to this
     * statement (AND, OR). Resets to AND once a clause is appended.
     */
    setConnector(connector: string): void {
        this.nextConnector = connector;
    }

    append(clause: WhereClause): WhereStatement {
        if (this.clauses.length) {
            this.connectors.push(this.nextConnector);
            this.nextConnector = CONNECTOR_AND;
        }

        this.clauses.push(clause);

        return this;
    }

    last(): WhereClause | undefined {
        return this.clauses[this.clauses.length - 1];
    }

    toString(): string {
        if (!this.clauses.length) {
            return '';
        }

        const statements = this.clauses.map((clause) => clause.toString());

        let joined = statements[0];

        for (let i = 1; i < statements.length; i++) {
            joined += ` ${this.connectors[i - 1]} ${statements[i]}`;
        }

        const prefix = this.prefix ? `${this.prefix} ` : '';

        return `${prefix}(${joined})`;
    }
}
