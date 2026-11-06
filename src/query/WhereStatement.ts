export const CONNECTOR_AND = 'AND';
export const CONNECTOR_OR = 'OR';

interface WhereClause {
    toString(): string;
}

export default class WhereStatement {
    private clauses: WhereClause[] = [];
    private connector = CONNECTOR_AND;

    constructor(private readonly prefix: string = '') {}

    setConnector(connector: string): void {
        this.connector = connector;
    }

    append(clause: WhereClause): WhereStatement {
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

        const statements = this.clauses
            .map((clause) => clause.toString())
            .join(` ${this.connector} `);

        const prefix = this.prefix ? `${this.prefix} ` : '';

        return `${prefix}(${statements})`;
    }
}
