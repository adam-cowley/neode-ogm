import { repositories } from "../meta";
import INeode from '../neode.interface'

export default class Repository<Entity extends Object> {

    // TODO: Get singleton?
    constructor(protected readonly neode: INeode, private readonly database?: string) {}

    protected getEntity() {
        if ( !repositories.has(this.constructor) ) {
            throw new Error(`Could not find a registered repository for ${this.constructor.name}.  Have you decorated the class with @Repository?`)
        }

        return repositories.get(typeof this)
    }

    async create(object: Entity): Promise<Entity> {
        return null
    }

    merge(object: Entity): Promise<Entity> {
        return this.neode.save(object)
    }

    async delete(id: any): Promise<void> {
        return null
    }
}