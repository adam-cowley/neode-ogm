import { ConnectionProvider } from '../../driver/types';
import { getModels } from '../../meta';
import EntitySchema from '../../meta/entity/entity-schema';
import PropertySchema from '../../meta/property-schema';

export enum ConstraintAction {
    CREATE = 'CREATE',
    DROP = 'DROP',
}

export enum ConstraintType {
    UNIQUE = 'UNIQUE',
    EXISTS = 'EXISTS',
    INDEX = 'INDEX',
}

export interface SchemaResult {
    action: ConstraintAction;
    type: ConstraintType;
    label: string;
    property: string;
    statement: string;
    success: boolean;
    error?: Error;
}

export default class SchemaService {
    constructor(
        private readonly connection: ConnectionProvider,
        private readonly enterprise: boolean = false
    ) {}

    create(): Promise<SchemaResult[]> {
        return this.runSchemaStatements(ConstraintAction.CREATE);
    }

    drop(): Promise<SchemaResult[]> {
        return this.runSchemaStatements(ConstraintAction.DROP);
    }

    private async runSchemaStatements(action: ConstraintAction): Promise<SchemaResult[]> {
        const output = await Promise.all(
            Array.from(getModels().values()).map((model) =>
                this.runSchemaStatementsForModel(action, model)
            )
        );

        return output.reduce(
            (acc: SchemaResult[], current: SchemaResult[]) => acc.concat(current),
            []
        );
    }

    private async runSchemaStatementsForModel(
        action: ConstraintAction,
        model: EntitySchema
    ): Promise<SchemaResult[]> {
        const output = await Promise.all(
            model.getLabels().map((label) => this.runSchemaStatementsForLabel(action, model, label))
        );

        return output.reduce(
            (acc: SchemaResult[], current: SchemaResult[]) => acc.concat(current),
            []
        );
    }

    private async runSchemaStatementsForLabel(
        action: ConstraintAction,
        model: EntitySchema,
        label: string
    ): Promise<SchemaResult[]> {
        const output = await this.runUniqueConstraintStatementsForLabel(
            action,
            model.getProperties(),
            label
        );

        const indexes = await this.runIndexStatementsForLabel(
            action,
            model.getProperties(),
            label
        );

        if (this.enterprise) {
            const exists = await this.runExistsConstraintStatementsForLabel(
                action,
                model.getProperties(),
                label
            );

            return output.concat(...indexes, ...exists);
        }

        return output.concat(...indexes);
    }

    private runUniqueConstraintStatementsForLabel(
        action: ConstraintAction,
        properties: PropertySchema[],
        label: string
    ): Promise<SchemaResult[]> {
        return Promise.all(
            properties
                .filter((property) => property.isUnique())
                .map((property) =>
                    this.runStatement(
                        action,
                        ConstraintType.UNIQUE,
                        label,
                        property.getKey()
                    )
                )
        );
    }

    private runExistsConstraintStatementsForLabel(
        action: ConstraintAction,
        properties: PropertySchema[],
        label: string
    ): Promise<SchemaResult[]> {
        return Promise.all(
            properties
                .filter((property) => property.isExists())
                .map((property) =>
                    this.runStatement(
                        action,
                        ConstraintType.EXISTS,
                        label,
                        property.getKey()
                    )
                )
        );
    }

    private runIndexStatementsForLabel(
        action: ConstraintAction,
        properties: PropertySchema[],
        label: string
    ): Promise<SchemaResult[]> {
        return Promise.all(
            properties
                .filter((property) => property.isIndex())
                .map((property) =>
                    this.runStatement(
                        action,
                        ConstraintType.INDEX,
                        label,
                        property.getKey()
                    )
                )
        );
    }

    private async runStatement(
        action: ConstraintAction,
        type: ConstraintType,
        label: string,
        property: string
    ): Promise<SchemaResult> {
        // Modern (Neo4j 4.4+/5.x) syntax, with IF NOT/DOES NOT EXIST guards
        // so install and drop are idempotent
        const guard =
            action === ConstraintAction.CREATE ? 'IF NOT EXISTS' : 'IF EXISTS';

        const name = `${label.toLowerCase()}_${property}_${type.toLowerCase()}`;

        const kind = type === ConstraintType.INDEX ? 'INDEX' : 'CONSTRAINT';

        const statement =
            action === ConstraintAction.CREATE
                ? `${action} ${kind} ${name} ${guard} FOR (n:${label}) ${
                      type === ConstraintType.INDEX
                          ? `ON (n.\`${property}\`)`
                          : `REQUIRE ${
                                type === ConstraintType.UNIQUE
                                    ? `n.\`${property}\` IS UNIQUE`
                                    : `n.\`${property}\` IS NOT NULL`
                            }`
                  }`
                : `${action} ${kind} ${name} ${guard}`;

        const output: SchemaResult = {
            action,
            type,
            label,
            property,
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
