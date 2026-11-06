import Builder from '../query'
import { THIS_NODE } from '../constants'
import { getModel } from '../meta'
import EntitySchema from '../meta/entity/entity-schema'
import PropertySchema from '../meta/property-schema'
import INeode from '../neode.interface'

export default class Repository<Entity> {

    protected schema: EntitySchema

    constructor(
        protected readonly neode: INeode,
        protected readonly entity: new (...args: never[]) => Entity,
        protected readonly database?: string,
    ) {
        this.schema = getModel(entity)
    }

    protected getLabels(): string[] {
        return this.schema.getLabels()
    }

    getPrimaryKey(): PropertySchema {
        return this.schema.getProperties().find(property => property.isPrimaryKey())!
    }

    async find(id: unknown): Promise<Entity | undefined> {
        return this.neode.find(this.entity, id as string, this.database) as Promise<Entity | undefined>
    }

    save(object: Entity): Promise<Entity> {
        return this.neode.save(object as unknown as object) as Promise<Entity>
    }

    async delete(id: unknown): Promise<void> {
        const entity = await this.find(id)

        if ( !entity ) {
            throw new Error(`Cannot delete: entity not found for ID ${String(id)}`)
        }

        return this.neode.delete(entity)
    }

    matchEntity(variable: string = THIS_NODE, object: Entity): Builder {
        const builder = new Builder()

        const primaryKey = this.getPrimaryKey().getKey()
        const value = (object as unknown as Record<string, unknown>)[ primaryKey ]

        return builder.match(variable, this.schema.getLabels(), { [primaryKey]: value })
    }

}
