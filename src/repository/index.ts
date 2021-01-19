import Builder from '@neode/querybuilder'
import { THIS_NODE } from '../constants'
import { getModel } from '../meta'
import EntitySchema from '../meta/entity/entity-schema'
import PropertySchema from '../meta/property-schema'
import INeode from '../neode.interface'

export default class Repository<Entity> {

    protected schema: EntitySchema

    constructor(
        protected readonly neode: INeode,
        protected readonly entity: Entity,
        protected readonly database?: string,
    ) {
        this.schema = getModel(entity.constructor)
    }

    protected getLabels(): string[] {
        return this.schema.getLabels()
    }

    getPrimaryKey(): PropertySchema {
        return this.schema.getProperties().find(property => property.isPrimaryKey())
    }

    async find(id: any): Promise<Entity> {
        return this.neode.find(this.entity, id, this.database)
    }

    save(object: Entity): Promise<Entity> {
        return this.neode.save(object)
    }

    async delete(id: any): Promise<void> {
        return this.neode.delete(this.find(id))
    }

    matchEntity(variable: string = THIS_NODE, object: Entity): Builder<Entity> {
        const builder = new Builder()

        const primaryKey = this.getPrimaryKey().getKey()
        const value = object[ primaryKey ]

        return builder.match(variable, this.schema.getLabels(), { [primaryKey]: value })
    }

}