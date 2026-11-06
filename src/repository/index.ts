import Builder, { eagerNode } from '../query/index.js'
import { THIS_NODE } from '../constants.js'
import { getModel } from '../meta/index.js'
import type { Newable } from '../meta/newable.js'
import type EntitySchema from '../meta/entity/entity-schema.js'
import type PropertySchema from '../meta/property-schema.js'
import type INeode from '../neode.interface.js'
import type { GraphNode, QueryOutput } from '../driver/types.js'
import { hydrateNode } from '../utils.js'

/**
Ordering spec, matching neode's all() forms:

- `'name'` - order by one property ascending
- `['name', 'age']` - order by several properties
- `{ name: 'DESC' }` - property -> direction map
- `[{ name: 'DESC' }, { age: 'ASC' }]` - list of property -> direction maps
- `{ field: 'name', order: 'DESC' }` - two-arg (key, direction) descriptor
*/
export type OrderSpec =
  | string
  | (string | Record<string, string>)[]
  | Record<string, string>
  | { field: string; order?: string }

export interface FindOptions {
  order?: OrderSpec
  limit?: number
  skip?: number
}

export default class Repository<Entity> {
  protected schema: EntitySchema

  protected readonly neode: INeode
  protected readonly entity: new (...arguments_: never[]) => Entity
  protected readonly database: string | undefined

  constructor(
    neode: INeode,
    entity: new (...arguments_: never[]) => Entity,
    database?: string,
  ) {
    this.neode = neode
    this.entity = entity
    this.database = database
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

  async findAll(parameters: Partial<Entity> = {}, options: FindOptions = {}): Promise<Entity[]> {
    const builder = this.matchAll(parameters)

    if (options.order) {
      this.applyOrder(builder, options.order)
    }

    this.returnNodes(builder)

    if (options.skip) {builder.skip(options.skip)}
    if (options.limit) {builder.limit(options.limit)}

    const output = await this.read(builder)

    return output.records.map((row) =>
      hydrateNode<Entity>(
        this.schema,
        this.entity as unknown as Newable,
        row.get(THIS_NODE) as GraphNode,
      ),
    )
  }

  async where(parameters: Partial<Entity> = {}): Promise<Entity[]> {
    return this.findAll(parameters)
  }

  async count(parameters: Partial<Entity> = {}): Promise<number> {
    const builder = this.matchAll(parameters)

    builder.return(`count(${THIS_NODE}) AS count`)

    const output = await this.read(builder)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new Error('count query returned no records')
    }

    return Repository.toCount(firstRecord.get('count'))
  }

  async save(object: Entity): Promise<Entity> {
    return this.neode.save(object as unknown as object, this.database) as Promise<Entity>
  }

  /**
  Save entities one at a time: each save opens its own write transaction,
  so concurrent saves would conflict on single-transaction connections
  */
  async saveAll(objects: Entity[]): Promise<Entity[]> {
    const saved: Entity[] = []

    for (const object of objects) {
      saved.push(await this.save(object))
    }

    return saved
  }

  /**
  Apply a partial patch to a persisted entity, then persist it.
  
  The INeode facade has no dedicated update method and the repository
  holds no Runner, so update is implemented through save(): a merge on
  the entity's primary key that sets the patched properties — update
  semantics for anything previously saved.
  */
  async update(entity: Entity, properties: Partial<Entity>): Promise<Entity> {
    Object.assign(entity as unknown as object, properties)

    return this.save(entity)
  }

  /**
  Delete by primary key value or by entity instance
  */
  async delete(target: Entity | string | number): Promise<void> {
    if (target !== null && typeof target === 'object') {
      return this.neode.delete(target, this.database)
    }

    const entity = await this.find(target)

    if (!entity) {
      throw new Error(`Cannot delete: entity not found for ID ${String(target)}`)
    }

    return this.neode.delete(entity, this.database)
  }

  /**
  Delete every entity matching params and return the number deleted.
  
  shortcut: one DETACH DELETE statement rather than per-entity deletes,
  so per-node delete events and cascade options do not apply — switch to
  a loop over delete() when cascading bulk deletes are needed
  */
  async deleteAll(parameters: Partial<Entity> = {}): Promise<number> {
    const builder = this.matchAll(parameters)

    builder.detachDelete(THIS_NODE)
    builder.return(`count(${THIS_NODE}) AS count`)

    const { query, params: queryParameters } = builder.build()

    const output = await this.neode.writeCypher(query, queryParameters, this.database)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new Error('count query returned no records')
    }

    return Repository.toCount(firstRecord.get('count'))
  }

  matchEntity(variable: string = THIS_NODE, object: Entity): Builder {
    const builder = new Builder()

    const primaryKey = this.getPrimaryKey().getKey()
    const value = (object as unknown as Record<string, unknown>)[primaryKey]

    return builder.match(variable, this.schema.getLabels(), { [primaryKey]: value })
  }

  /**
  Match every node of the entity's labels, filtered on the schema's
  declared properties only (GetService parity: unknown keys are ignored)
  */
  private matchAll(parameters: Partial<Entity> = {}): Builder {
    const record = parameters as Record<string, unknown>

    const builder = new Builder()

    builder.match(THIS_NODE, this.schema.getLabels())

    for (const property of this.schema.getProperties()) {
      const key = property.getKey()

      if (Object.hasOwn(record, key)) {
        builder.where(`${THIS_NODE}.${key}`, record[key])
      }
    }

    return builder
  }

  private returnNodes(builder: Builder): void {
    // Eager Loading: when the schema declares eager relationships the
    // root node is returned as a map projection (QueryService parity)
    if (this.schema.getRelationships().some((rel) => rel.getEager())) {
      builder.return(`${eagerNode(1, THIS_NODE, this.schema)} AS ${THIS_NODE}`)
    } else {
      builder.return(THIS_NODE)
    }
  }

  private applyOrder(builder: Builder, order: OrderSpec): void {
    if (typeof order === 'string') {
      builder.orderBy(`${THIS_NODE}.${order}`)
    } else if (Array.isArray(order)) {
      for (const entry of order) {this.applyOrder(builder, entry)}
    } else if ('field' in order && typeof order.field === 'string') {
      builder.orderBy({ field: `${THIS_NODE}.${order.field}`, order: order.order })
    } else {
      for (const [key, direction] of Object.entries(order)) {builder.orderBy(`${THIS_NODE}.${key}`, direction)}
      
    }
  }

  private async read(builder: Builder): Promise<QueryOutput> {
    const { query, params } = builder.build()

    return this.neode.readCypher(query, params, this.database)
  }

  /**
  Neo4j driver returns count() as an Integer instance, Relate as a number
  */
  private static toCount(value: unknown): number {
    return typeof value === 'object' &&
      value !== null &&
      typeof (value as { toNumber?: unknown }).toNumber === 'function' ? (value as { toNumber(): number }).toNumber() : Number(value);
  }
}
