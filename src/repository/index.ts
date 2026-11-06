import Builder, { eagerNode } from '../query'
import { THIS_NODE } from '../constants'
import { getModel } from '../meta'
import { Newable } from '../meta/newable'
import EntitySchema from '../meta/entity/entity-schema'
import PropertySchema from '../meta/property-schema'
import INeode from '../neode.interface'
import { GraphNode, QueryOutput } from '../driver/types'
import { hydrateNode } from '../utils'

/**
 * Ordering spec, matching neode's all() forms:
 *
 * - `'name'` - order by one property ascending
 * - `['name', 'age']` - order by several properties
 * - `{ name: 'DESC' }` - property -> direction map
 * - `[{ name: 'DESC' }, { age: 'ASC' }]` - list of property -> direction maps
 * - `{ field: 'name', order: 'DESC' }` - two-arg (key, direction) descriptor
 */
export type OrderSpec =
    | string
    | Array<string | Record<string, string>>
    | Record<string, string>
    | { field: string; order?: string }

export interface FindOptions {
    order?: OrderSpec
    limit?: number
    skip?: number
}

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
        return this.schema.getPrimaryKey()!
    }

    async find(id: unknown): Promise<Entity | undefined> {
        return this.neode.find(this.entity, id as string, this.database) as Promise<Entity | undefined>
    }

    async findBy(properties: Partial<Entity> = {}): Promise<Entity | undefined> {
        const results = await this.findAll(properties, { limit: 1 })

        return results[0]
    }

    async findAll(params: Partial<Entity> = {}, options: FindOptions = {}): Promise<Entity[]> {
        const builder = this.matchAll(params)

        if ( options.order ) {
            this.applyOrder(builder, options.order)
        }

        this.returnNodes(builder)

        if ( options.skip ) builder.skip(options.skip)
        if ( options.limit ) builder.limit(options.limit)

        const output = await this.read(builder)

        return output.records.map(row =>
            hydrateNode<Entity>(
                this.schema,
                this.entity as unknown as Newable,
                row.get(THIS_NODE) as GraphNode
            )
        )
    }

    where(params: Partial<Entity> = {}): Promise<Entity[]> {
        return this.findAll(params)
    }

    async count(params: Partial<Entity> = {}): Promise<number> {
        const builder = this.matchAll(params)

        builder.return(`count(${THIS_NODE}) AS count`)

        const output = await this.read(builder)

        return Repository.toCount(output.records[0].get('count'))
    }

    save(object: Entity): Promise<Entity> {
        return this.neode.save(object as unknown as object, this.database) as Promise<Entity>
    }

    /**
     * Save entities one at a time: each save opens its own write transaction,
     * so concurrent saves would conflict on single-transaction connections
     */
    async saveAll(objects: Entity[]): Promise<Entity[]> {
        const saved: Entity[] = []

        for (const object of objects) {
            saved.push(await this.save(object))
        }

        return saved
    }

    /**
     * Apply a partial patch to a persisted entity, then persist it.
     *
     * The INeode facade has no dedicated update method and the repository
     * holds no Runner, so update is implemented through save(): a merge on
     * the entity's primary key that sets the patched properties — update
     * semantics for anything previously saved.
     */
    async update(entity: Entity, properties: Partial<Entity>): Promise<Entity> {
        Object.assign(entity as unknown as object, properties)

        return this.save(entity)
    }

    /**
     * Delete by primary key value or by entity instance
     */
    async delete(target: Entity | string | number): Promise<void> {
        if ( target !== null && typeof target === 'object' ) {
            return this.neode.delete(target, this.database)
        }

        const entity = await this.find(target)

        if ( !entity ) {
            throw new Error(`Cannot delete: entity not found for ID ${String(target)}`)
        }

        return this.neode.delete(entity, this.database)
    }

    /**
     * Delete every entity matching params and return the number deleted.
     *
     * shortcut: one DETACH DELETE statement rather than per-entity deletes,
     * so per-node delete events and cascade options do not apply — switch to
     * a loop over delete() when cascading bulk deletes are needed
     */
    async deleteAll(params: Partial<Entity> = {}): Promise<number> {
        const builder = this.matchAll(params)

        builder.detachDelete(THIS_NODE)
        builder.return(`count(${THIS_NODE}) AS count`)

        const { query, params: queryParams } = builder.build()

        const output = await this.neode.writeCypher(query, queryParams, this.database)

        return Repository.toCount(output.records[0].get('count'))
    }

    matchEntity(variable: string = THIS_NODE, object: Entity): Builder {
        const builder = new Builder()

        const primaryKey = this.getPrimaryKey().getKey()
        const value = (object as unknown as Record<string, unknown>)[ primaryKey ]

        return builder.match(variable, this.schema.getLabels(), { [primaryKey]: value })
    }

    /**
     * Match every node of the entity's labels, filtered on the schema's
     * declared properties only (GetService parity: unknown keys are ignored)
     */
    private matchAll(params: Partial<Entity> = {}): Builder {
        const record = params as Record<string, unknown>

        const builder = new Builder()

        builder.match(THIS_NODE, this.schema.getLabels())

        this.schema.getProperties().forEach((property) => {
            const key = property.getKey()

            if (Object.hasOwn(record, key)) {
                builder.where(`${THIS_NODE}.${key}`, record[ key ])
            }
        })

        return builder
    }

    private returnNodes(builder: Builder): void {
        // Eager Loading: when the schema declares eager relationships the
        // root node is returned as a map projection (QueryService parity)
        if ( this.schema.getRelationships().some(rel => rel.getEager()) ) {
            builder.return(`${eagerNode(1, THIS_NODE, this.schema)} AS ${THIS_NODE}`)
        } else {
            builder.return(THIS_NODE)
        }
    }

    private applyOrder(builder: Builder, order: OrderSpec): void {
        if ( typeof order === 'string' ) {
            builder.orderBy(`${THIS_NODE}.${order}`)
        } else if ( Array.isArray(order) ) {
            order.forEach(entry => this.applyOrder(builder, entry))
        } else if ( 'field' in order && typeof order.field === 'string' ) {
            builder.orderBy({ field: `${THIS_NODE}.${order.field}`, order: order.order })
        } else {
            Object.entries(order).forEach(([ key, direction ]) =>
                builder.orderBy(`${THIS_NODE}.${key}`, direction)
            )
        }
    }

    private read(builder: Builder): Promise<QueryOutput> {
        const { query, params } = builder.build()

        return this.neode.readCypher(query, params, this.database)
    }

    /**
     * Neo4j driver returns count() as an Integer instance, Relate as a number
     */
    private static toCount(value: unknown): number {
        if ( typeof value === 'object' && value !== null && typeof (value as { toNumber?: unknown }).toNumber === 'function' ) {
            return (value as { toNumber(): number }).toNumber()
        }

        return Number(value)
    }

}
