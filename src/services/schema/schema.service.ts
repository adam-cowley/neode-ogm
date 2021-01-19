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

export default class SchemaService {
    constructor(private readonly driver: Driver) {}

    async create(): Promise<void> {
        await this.runSchemaStatements(ConstraintAction.CREATE)
    }

    async drop(): Promise<void> {
        await this.runSchemaStatements(ConstraintAction.DROP)
    }

    private runSchemaStatements(action: ConstraintAction) {
        return Promise.all(
            Array.from(getModels().values())
                .map(model => this.runSchemaStatementsForModel(action, model))
        )

    }

    runSchemaStatementsForModel(action: ConstraintAction, model: EntitySchema) {
        return Promise.all(
            model.getLabels()
                .map(label => this.runSchemaStatementsForLabel(action, model, label))
        )
    }

    runSchemaStatementsForLabel(action: ConstraintAction, model: EntitySchema, label: string) {
        return this.runUniqueConstraintStatementsForLabel(action, model.getProperties(), label)
    }

    runUniqueConstraintStatementsForLabel(action: ConstraintAction, properties: PropertySchema[], label: string) {
        return Promise.all(properties.filter(property => property.isUnique())
            .map(property => this.constraintStatement(action, ConstraintType.UNIQUE, label, property.getKey()))
        )
    }

    runExistsConstraintStatementsForLabel(action: ConstraintAction, properties: PropertySchema[], label: string) {
        return Promise.all(properties.filter(property => property.isUnique())
            .map(property => this.constraintStatement(action, ConstraintType.EXISTS, label, property.getKey()))
        )
    }

    async constraintStatement(action: ConstraintAction, type: ConstraintType, label: string, property: string): Promise<void> {
        const session = this.driver.session({ defaultAccessMode: SessionMode.WRITE })

        try {
            const statement = type === ConstraintType.UNIQUE ? `n.\`${property}\` IS UNIQUE` : `exists(n.\`${property}\`)`

            await session.writeTransaction(tx => tx.run(`${action} CONSTRAINT ON (n:${label}) ASSERT ${statement}`))
                .catch(e => console.log(e.message))
        }
        catch (e) {
            console.log(e);
        }

        await session.close()
    }
}