import { ConnectionProvider } from '../../driver/types';
import { ConstraintAction, ConstraintType, SchemaResult, schemaObjectName } from './schema.service';

/** A full-text index to keep installed on the database */
export interface FulltextIndexDefinition {
    label: string;
    properties: string[];
    /** Defaults to `<label>_<props joined by _>_fulltext` */
    name?: string;
}

export function fulltextIndexName(definition: FulltextIndexDefinition): string {
    if (definition.name) {
        return definition.name;
    }

    return schemaObjectName(
        definition.label,
        definition.properties.map((property) => property.toLowerCase()).join('_'),
        ConstraintType.FULLTEXT
    );
}

export function createFulltextStatement(definition: FulltextIndexDefinition): string {
    if (!definition.properties.length) {
        throw new TypeError(
            `Cannot create a full-text index on ${definition.label}: no properties given`
        );
    }

    const properties = definition.properties
        .map((property) => `n.\`${property.replaceAll('`', '``')}\``)
        .join(', ');

    return `CREATE FULLTEXT INDEX ${fulltextIndexName(definition)} IF NOT EXISTS FOR (n:${definition.label}) ON EACH [${properties}]`;
}

export function dropFulltextStatement(name: string): string {
    return `DROP FULLTEXT INDEX ${name} IF EXISTS`;
}

/**
 * Installs/drops the given full-text index definitions, following the same
 * result-reporting pattern as SchemaService
 */
export default class FulltextIndexService {
    constructor(
        private readonly connection: ConnectionProvider,
        private readonly definitions: FulltextIndexDefinition[]
    ) {}

    create(): Promise<SchemaResult[]> {
        return this.run(ConstraintAction.CREATE);
    }

    drop(): Promise<SchemaResult[]> {
        return this.run(ConstraintAction.DROP);
    }

    private run(action: ConstraintAction): Promise<SchemaResult[]> {
        return Promise.all(this.definitions.map((definition) => this.runOne(action, definition)));
    }

    private async runOne(action: ConstraintAction, definition: FulltextIndexDefinition): Promise<SchemaResult> {
        const statement =
            action === ConstraintAction.CREATE
                ? createFulltextStatement(definition)
                : dropFulltextStatement(fulltextIndexName(definition));

        const output: SchemaResult = {
            action,
            type: ConstraintType.FULLTEXT,
            label: definition.label,
            property: definition.properties[0],
            properties: definition.properties,
            statement,
            success: false,
        };

        try {
            await this.connection.run(statement, {}, 'WRITE');

            output.success = true;
        } catch (e) {
            output.error = e as Error;
        }

        return output;
    }
}
