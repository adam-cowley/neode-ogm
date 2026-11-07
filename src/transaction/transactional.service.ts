import type { EventEmitter } from 'node:events'
import type {
  GraphRelationship,
  QueryOutput,
  QueryParams as QueryParameters,
  Runner,
  TransactionHandle,
} from '../driver/types.js'
import { EventType } from '../common/events.js'
import { getModel, getModels } from '../meta/index.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { elementIdOfEntity } from '../utils.js'
import type { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import type INeode from '../neode.interface.js'
import DeleteService, { type DeleteOptions } from '../services/query/delete.service.js'
import DetachService, { type DetachResult } from '../services/query/detach.service.js'
import FindByIdService from '../services/query/find-by-id.service.js'
import FindService from '../services/query/find.service.js'
import GetService, { type OrderSpec } from '../services/query/get.service.js'
import MergeService from '../services/query/merge.service.js'
import RelateService from '../services/query/relate.service.js'
import UpdateService from '../services/query/update.service.js'
import WithinDistanceService from '../services/query/within-distance.service.js'
import { search, type ScoredEntity } from '../services/query/search.service.js'


export default class TransactionalService implements INeode {
  private readonly handle: TransactionHandle
  private readonly eventEmitter: EventEmitter

  constructor(handle: TransactionHandle, eventEmitter: EventEmitter) {
    this.handle = handle
    this.eventEmitter = eventEmitter
  }

  /**
  The underlying transaction handle — a Runner scoped to this transaction
  */
  getRunner(): Runner {
    return this.handle
  }

  getTransaction(): TransactionHandle {
    return this.handle
  }

  async commit(): Promise<void> {
    await this.handle.commit()
  }

  async rollback(): Promise<void> {
    await this.handle.rollback()
  }

  private getSchema(constructor: unknown): EntitySchema {
    const found = getModel(constructor)

    if (!found) {
      const name = (constructor as { name?: string })?.name || 'unknown'

      throw new Error(
        `Couldn't find a model for "${name}". Registered model(s) are: ${Array.from(
          getModels().keys(),
        )
          .map((model) => (model as { name?: string }).name)
          .join(', ')}`,
      )
    }

    return found
  }

  /**
  The relationship declared on the schema under the given key
  (mirror of the facade's relate-by-key resolution)
  */
  private requireRelationship(schema: EntitySchema, key: string): RelationshipPropertySchema {
    if (!schema.hasRelationship(key)) {
      throw new Error(
        `Unknown relationship "${key}" on ${schema.getLabels().join(':') || 'entity'}`,
      )
    }

    return schema.getRelationship(key)
  }

  async find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string,
    _database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    const service = new FindService(this.handle)

    return service.find(constructor, schema, value) as Promise<T | undefined>
  }

  async findById<T>(
    constructor: new (...arguments_: never[]) => T,
    id: string,
    _database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    const service = new FindByIdService(this.handle)

    return service.find(constructor, schema, id) as Promise<T | undefined>
  }

  async get<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown>,
    limit?: number,
    skip?: number,
    _database?: string,
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    const service = new GetService(this.handle)

    return service.get<T>(constructor, schema, parameters, limit, skip)
  }

  async getFirst<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown>,
    database?: string,
  ): Promise<T | undefined> {
    const records = await this.get<T>(constructor, parameters, 1, 0, database)

    return records[0]
  }

  async save<T>(entity: T, _database?: string): Promise<T> {
    const entityRecord = entity as unknown as Record<string, unknown>
    const schema = this.getSchema(entityRecord.constructor)

    const merge = new MergeService(this.handle)

    const { elementId } = await merge.save(entity as object, schema)

    const saved = await this.findById<T>(
      entityRecord.constructor as new (
        ...arguments_: never[]
      ) => T,
      elementId,
    )

    if (!saved) {
      throw new Error('Entity was saved but could not be found immediately afterwards')
    }

    // Emit event
    this.eventEmitter.emit(EventType.NODE_CREATED, saved)

    return saved
  }

  /**
  Delete a node in this transaction's scope. `options` threads the
  cascade modes through; the legacy string second argument (database)
  stays accepted, as on the facade.
  */
  async delete<T>(entity: T, options?: DeleteOptions | string, _database?: string): Promise<void> {
    const schema = this.getSchema((entity as unknown as Record<string, unknown>).constructor)

    const service = new DeleteService(this.handle)

    await service.delete(
      schema,
      entity as object,
      typeof options === 'string' ? undefined : options,
    )

    // Emit event
    this.eventEmitter.emit(EventType.NODE_DELETED, entity)
  }

  /**
  UPDATE the given properties on a node (`+=` semantics), then
  re-hydrate it — mirror of the facade's update
  */
  async update<T>(
    entity: T,
    properties: Record<string, unknown> = {},
    _database?: string,
  ): Promise<T | undefined> {
    const entityRecord = entity as unknown as Record<string, unknown>
    const schema = this.getSchema(entityRecord.constructor)

    await new UpdateService(this.handle).update(schema, entity as object, properties)

    const elementId = elementIdOfEntity(schema, entity as object)

    return elementId ? (new FindByIdService(this.handle).find(
      entityRecord.constructor as new (
        ...arguments_: never[]
      ) => T,
      schema,
      elementId,
    ) as Promise<T | undefined>) : undefined;
  }

  /**
  Relate two saved nodes by the relationship's KEY on the from-entity's
  schema — mirror of the facade's relate
  */
  async relate<From extends object, To extends object>(
    constructor: new (...arguments_: never[]) => From,
    from: From,
    to: To,
    relationshipKey: string,
    properties: Record<string, unknown> = {},
    forceCreate = false,
  ): Promise<GraphRelationship | undefined> {
    const schema = this.getSchema(constructor)
    const rel = this.requireRelationship(schema, relationshipKey)

    const result = await new RelateService(this.handle).relate(
      schema,
      from,
      to,
      rel,
      properties,
      forceCreate,
    )

    if (result) {
      this.eventEmitter.emit(
        forceCreate ? EventType.RELATIONSHIP_CREATED : EventType.RELATIONSHIP_MERGED,
        result,
      )
    }

    return result
  }

  /**
  Remove the relationship of the given key between two nodes and return
  both re-hydrated — mirror of the facade's detach
  */
  async detach<From extends object, To extends object>(
    constructor: new (...arguments_: never[]) => From,
    from: From,
    to: To,
    relationshipKey: string,
  ): Promise<DetachResult<From, To>> {
    const schema = this.getSchema(constructor)
    const rel = this.requireRelationship(schema, relationshipKey)

    return new DetachService(this.handle).detach(schema, from, to, rel)
  }

  /**
  ALL nodes of the given constructor, optionally filtered, ordered,
  limited and skipped — mirror of the facade's all
  */
  async all<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    _database?: string,
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    return new GetService(this.handle).get<T>(constructor, schema, parameters, limit, skip, order)
  }

  async search<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    query: string,
    limit?: number,
  ): Promise<ScoredEntity<T>[]> {
    return search<T>(this.handle, constructor, indexName, query, limit)
  }

  /**
  Nodes of the given constructor within `distance` of the given point —
  mirror of the facade's withinDistance
  */
  async withinDistance<T>(
    constructor: new (...arguments_: never[]) => T,
    locationProperty: string,
    point: unknown,
    distance: number,
    parameters: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    _database?: string,
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    return new WithinDistanceService(this.handle).withinDistance<T>(
      constructor,
      schema,
      locationProperty,
      point,
      distance,
      parameters,
      order,
      limit,
      skip,
    )
  }

  /**
  Run a query in this transaction's scope
  */
  async readCypher(query: string, parameters: QueryParameters = {}): Promise<QueryOutput> {
    return this.handle.run(query, parameters)
  }

  async writeCypher(query: string, parameters: QueryParameters = {}): Promise<QueryOutput> {
    return this.handle.run(query, parameters)
  }
}
