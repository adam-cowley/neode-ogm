import { Driver, session as Session } from "neo4j-driver";

import { getModels } from "../../meta";
import EntitySchema from "../../meta/entity/entity-schema";

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

    create(): Promise<void> {
        return this.runSchemaStatements(ConstraintAction.CREATE)
    }

    drop(): Promise<void> {
        return this.runSchemaStatements(ConstraintAction.DROP)
    }

    private async runSchemaStatements(action: ConstraintAction) {
        const session = this.driver.session({ defaultAccessMode: Session.WRITE })

        Array.from(getModels().values())
            .map(async model => {
                const properties = model.getProperties()

                // Unique Constraints
                await Promise.all(
                    model.getLabels()
                        .map(label => {
                            return Promise.all(properties.filter(property => property.isUnique())
                                .map(property => this.constraintStatement(action, ConstraintType.UNIQUE, label, property.getKey()))
                            )
                        })
                )

                // TODO: Exists Constraints

            })

        await session.close()
    }

    async constraintStatement(action: ConstraintAction, type: ConstraintType, label: string, property: string): Promise<void> {
        const statement = type === ConstraintType.UNIQUE ? `n.\`${property}\` IS UNIQUE` : `exists(n.\`${property}\`)`

        console.log(`${action} CONSTRAINT ON (n:${label}) ASSERT ${statement}`)
    }
}