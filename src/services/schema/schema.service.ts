import { Driver, session as SessionMode } from "neo4j-driver";
import { getModels } from "../../meta";
import EntitySchema from "../../meta/entity/entity-schema"
import PropertySchema from "../../meta/property-schema";

enum ConstraintAction {
    CREATE = 'CREATE',
    DROP = 'DROP'
}

enum ConstraintType {
    UNIQUE,
    EXISTS
}

export interface SchemaResult {
    action: ConstraintAction,
    type: ConstraintType,
    label: string;
    property: string;
    statement: string;
    success: boolean;
    error?: Error;
}

export default class SchemaService {
    constructor(private readonly driver: Driver, private readonly enterprise: boolean = false) {}

    create(): Promise<SchemaResult[]> {
        return this.runSchemaStatements(ConstraintAction.CREATE)
    }

    drop(): Promise<SchemaResult[]> {
        return this.runSchemaStatements(ConstraintAction.DROP)
    }

    private async runSchemaStatements(action: ConstraintAction): Promise<SchemaResult[]> {
        const output = await Promise.all(Array.from(getModels().values())
            .map(async model => await this.runSchemaStatementsForModel(action, model))
        )

        return output.reduce((acc: SchemaResult[], current: SchemaResult[]) => acc.concat(current) , []) as SchemaResult[]
    }

    async runSchemaStatementsForModel(action: ConstraintAction, model: EntitySchema): Promise<SchemaResult[]> {
        const output = await Promise.all(model.getLabels()
            .map(label => this.runSchemaStatementsForLabel(action, model, label))
        )

        return output.reduce((acc: SchemaResult[], current: SchemaResult[]) => acc.concat(current) , []) as SchemaResult[]
    }

    async runSchemaStatementsForLabel(action: ConstraintAction, model: EntitySchema, label: string): Promise<SchemaResult[]> {
        let output: SchemaResult[] = (await this.runUniqueConstraintStatementsForLabel(action, model.getProperties(), label))
            .reduce((acc: SchemaResult[], value: SchemaResult) => acc.concat(value), [])


        if ( this.enterprise ) {
            return output.concat(...await this.runExistsConstraintStatementsForLabel(action, model.getProperties(), label))
        }

        return output
    }

    runUniqueConstraintStatementsForLabel(action: ConstraintAction, properties: PropertySchema[], label: string): Promise<SchemaResult[]> {
        return Promise.all(properties.filter(property => property.isUnique())
            .map(property => this.constraintStatement(action, ConstraintType.UNIQUE, label, property.getKey()))
        )
    }

    runExistsConstraintStatementsForLabel(action: ConstraintAction, properties: PropertySchema[], label: string): Promise<SchemaResult[]> {
        return Promise.all(properties.filter(property => property.isUnique())
            .map(property => this.constraintStatement(action, ConstraintType.EXISTS, label, property.getKey()))
        )
    }

    async constraintStatement(action: ConstraintAction, type: ConstraintType, label: string, property: string): Promise<SchemaResult> {
        const session = this.driver.session({ defaultAccessMode: SessionMode.WRITE })

        const statement = type === ConstraintType.UNIQUE ? `n.\`${property}\` IS UNIQUE` : `exists(n.\`${property}\`)`

        const output: SchemaResult = {
            action,
            type,
            label,
            property,
            statement,
            success: false
        }

        try {
            await session.writeTransaction(tx => tx.run(`${action} CONSTRAINT ON (n:${label}) ASSERT ${statement}`))

            output.success = true
        }
        catch (e) {
            output.error = e
        }

        await session.close()

        return output
    }
}