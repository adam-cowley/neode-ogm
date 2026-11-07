import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import type {
  AccessMode,
  ConnectionOptions,
  ConnectionProvider,
  CypherOptions,
  GraphRelationship,
  QueryOutput,
  QueryParams as QueryParameters,
  Runner,
  TransactionHandle,
} from './driver/types.js'
import { Neo4jConnectionProvider as Neo4indexConnectionProvider } from './driver/neo4j.js'
import { RelateConnectionProvider } from './driver/relate.js'
import { instrumentConnectionProvider } from './driver/instrumented.js'
import { jsonSafeRecord } from './driver/json-safe.js'
import { hydrate } from './hydrate.js'
import { setDefaultNeode } from './entity-methods.js'
import { getModel, getModels, resolveRepository } from './meta/index.js'
import type { Newable } from './meta/newable.js'
import type EntitySchema from './meta/entity/entity-schema.js'
import type RelationshipPropertySchema from './meta/relationship-property-schema.js'
import {
  defineModel,
  extendModel,
  getModelByName,
  unknownDefinitionError,
} from './meta/map-schema.js'
import { ontology, ontologyMarkdown, type Ontology } from './meta/ontology.js'
import type { SchemaDefinition } from './meta/schema-definition.interface.js'
import { EventType, type NeodeEventHandler } from './common/events.js'
import FindService from './services/query/find.service.js'
import MergeService, { getMergeFields } from './services/query/merge.service.js'
import CreateService from './services/query/create.service.js'
import DeleteService, { type DeleteOptions } from './services/query/delete.service.js'
import DetachService, { type DetachResult } from './services/query/detach.service.js'
import type INeode from './neode.interface.js'
import GetService, { type OrderSpec } from './services/query/get.service.js'
import RelateService from './services/query/relate.service.js'
import UpdateService from './services/query/update.service.js'
import WithinDistanceService from './services/query/within-distance.service.js'
import SchemaService, { type SchemaResult } from './services/schema/schema.service.js'
import type Repository from './repository/index.js'
import TransactionalService from './transaction/transactional.service.js'
import { rollbackAfterFailure } from './transaction/rollback.js'
import TransactionError, { type BatchStatementError } from './transaction/errors.js'
import FindByIdService from './services/query/find-by-id.service.js'
import { INTERNAL_ID } from './constants.js'
import { elementIdOfEntity } from './utils.js'
import Builder, { quote } from './query/index.js'
import { search, type ScoredEntity } from './services/query/search.service.js'
import FactoryBuilder from './services/factory.service.js'
import { knn, type KnnMode } from './services/query/knn.service.js'
import {
  inspectSchema,
  type InspectOptions,
  type SchemaInspection,
} from './services/schema/inspect.service.js'
import {
  type ApplySchemaDiffOptions,
  applySchemaDrift,
  formatSchemaDrift,
  type SchemaDrift,
  schemaDrift,
} from './services/schema/drift.service.js'
import FulltextIndexService, {
  type FulltextIndexDefinition,
} from './services/schema/fulltext.service.js'
import VectorIndexService, { type VectorIndexDefinition } from './services/schema/vector.service.js'
import BulkService, { type BulkChunk, type BulkOptions } from './services/query/bulk.service.js'
import PaginateService, {
  type Page,
  type CursorPage,
  type OffsetPaginateOptions,
  type CursorPaginateOptions,
} from './services/query/paginate.service.js'
import ProjectionService from './projection/projection.service.js'
import { hasProjectedProperties } from './projection/index.js'
import { runCypherScript, type RunCypherScriptOptions } from './ops/index.js'

export default class Neode implements INeode {
  private readonly eventEmitter: EventEmitter = new EventEmitter()

  private readonly connection: ConnectionProvider

  private database: string | undefined

  private defaultRouting: AccessMode | undefined

  private enterprise = false

  constructor(connection: ConnectionProvider, enterprise = false, options: ConnectionOptions = {}) {
    this.enterprise = enterprise

    // Every statement — raw and service queries, inside and outside
    // transactions — funnels through this wrapper, the shared chokepoint
    // the query:executed lifecycle event emits from
    this.connection = instrumentConnectionProvider(connection, (event) =>
      this.eventEmitter.emit(EventType.QUERY_EXECUTED, event),
    )

    this.defaultRouting = options.defaultRouting

    // Instance methods on hydrated entities (save/update/delete/relateTo)
    // resolve their Neode through the last-constructed instance
    setDefaultNeode(this)
  }

  /**
  Create a Neode instance over a neo4j-driver Driver
  (Neo4j Community / Enterprise, Memgraph, or any Bolt server)
  */
  static forDriver(
    driver: import('neo4j-driver').Driver,
    database?: string,
    enterprise = false,
    options: ConnectionOptions = {},
  ): Neode {
    return new Neode(new Neo4indexConnectionProvider(driver, database), enterprise, options)
  }

  /**
  Create a Neode instance over an embedded Relate database
  (in-memory or file-backed)
  */
  static forRelate(
    database: unknown,
    namespace = 'neo4j',
    enterprise = false,
    options: ConnectionOptions = {},
  ): Neode {
    return new Neode(
      new RelateConnectionProvider(database as never, namespace),
      enterprise,
      options,
    )
  }

  getConnection(): ConnectionProvider {
    return this.connection
  }

  getRunner(): Runner {
    return this.connection
  }

  isEnterprise(): boolean {
    return this.enterprise
  }

  setEnterprise(enterprise: boolean): void {
    this.enterprise = enterprise
  }

  /**
  Set the default database for all future statements (neode parity).
  A per-call `database` argument wins over this default, which in turn
  wins over the provider's own constructor database.
  */
  setDatabase(database?: string): void {
    this.database = database
  }

  /**
  Subscribe to a lifecycle event — see EventType (common/events.ts).
  Returns this for chaining.
  */
  on(event: EventType, handler: NeodeEventHandler): this {
    this.eventEmitter.on(event, handler)

    return this
  }

  /**
  Unsubscribe a previously registered event handler.
  */
  off(event: EventType, handler: NeodeEventHandler): this {
    this.eventEmitter.off(event, handler)

    return this
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
  (neode's relateTo resolves the relationship by definition key)
  */
  private requireRelationship(schema: EntitySchema, key: string): RelationshipPropertySchema {
    if (!schema.hasRelationship(key)) {
      throw new Error(
        `Unknown relationship "${key}" on ${schema.getLabels().join(':') || 'entity'}`,
      )
    }

    return schema.getRelationship(key)
  }

  /**
  Resolve a relationship by its definition KEY, falling back to the
  relationship TYPE (neode's relate(from, to, type) accepts either)
  */
  private resolveRelationship(schema: EntitySchema, keyOrType: string): RelationshipPropertySchema {
    if (schema.hasRelationship(keyOrType)) {
      return schema.getRelationship(keyOrType)
    }

    const byType = schema.getRelationships().find((rel) => rel.getType() === keyOrType)

    if (byType) {
      return byType
    }

    throw new Error(
      `Unknown relationship "${keyOrType}" on ${schema.getLabels().join(':') || 'entity'}`,
    )
  }

  /**
  Run a single statement in an implicit transaction
  */
  async readCypher(
    query: string,
    parameters: QueryParameters = {},
    database?: string,
  ): Promise<QueryOutput> {
    return this.connection.run(query, parameters, 'READ', database ?? this.database)
  }

  async writeCypher(
    query: string,
    parameters: QueryParameters = {},
    database?: string,
  ): Promise<QueryOutput> {
    return this.connection.run(query, parameters, 'WRITE', database ?? this.database)
  }

  /**
  Set the routing used when a query path leaves it open — `cypher()`
  without a per-call `routing` option (default READ)
  */
  setDefaultRouting(routing: AccessMode): void {
    this.defaultRouting = routing
  }

  /**
  The unified raw query escape hatch: run any Cypher statement through
  the instance's connection, choosing READ or WRITE per call (`routing`,
  falling back to the connection's `defaultRouting`, then READ).
  
  Rows come back JSON-safe (graph values — Node, Relationship, Path,
  Point — serialised to plain structures). With the `hydrate` option the
  rows are instead hydrated into entities of the given class, read from
  the `alias` column ('this' by default, matching the query builder's
  return alias).
  */
  cypher(query: string, parameters?: QueryParameters, options?: CypherOptions): Promise<QueryOutput>
  cypher<T>(
    query: string,
    parameters: QueryParameters | undefined,
    options: CypherOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  async cypher(
    query: string,
    parameters: QueryParameters = {},
    options: CypherOptions = {},
  ): Promise<QueryOutput | unknown[]> {
    const output = await this.connection.run(
      query,
      parameters,
      options.routing ?? this.defaultRouting ?? 'READ',
      options.database ?? this.database,
    )

    const rows: QueryOutput = {
      records: output.records.map(jsonSafeRecord),
      summary: output.summary,
    }

    return options.hydrate ? hydrate(options.hydrate, rows, options.alias) : rows
  }

  /**
  The server's execution plan for the given statement (`EXPLAIN`): the
  driver's plan tree on backends that produce plans, `undefined` on
  those that don't (the embedded Relate engine accepts the keyword but
  reports no plan). EXPLAIN never executes the statement.
  */
  async explain(
    query: string,
    parameters: QueryParameters = {},
    options: { database?: string } = {},
  ): Promise<unknown> {
    const output = await this.connection.run(
      `EXPLAIN ${query}`,
      parameters,
      'READ',
      options.database ?? this.database,
    )

    return output.summary?.plan
  }

  /**
  The server's profiled plan for the given statement (`PROFILE`): unlike
  EXPLAIN the statement IS executed, so it routes WRITE. `undefined` on
  backends that produce no profiles (see explain()).
  */
  async profile(
    query: string,
    parameters: QueryParameters = {},
    options: { database?: string } = {},
  ): Promise<unknown> {
    const output = await this.connection.run(
      `PROFILE ${query}`,
      parameters,
      'WRITE',
      options.database ?? this.database,
    )

    return output.summary?.profile
  }

  /**
  Open an explicit READ transaction
  */
  async readTransaction(database?: string): Promise<TransactionHandle> {
    return this.connection.beginTransaction('READ', database ?? this.database)
  }

  /**
  Open an explicit WRITE transaction
  */
  async writeTransaction(database?: string): Promise<TransactionHandle> {
    return this.connection.beginTransaction('WRITE', database ?? this.database)
  }

  /**
  Open a transaction and return a TransactionalService
  (remember to call .commit() or .rollback())
  */
  async openReadTransaction(database?: string): Promise<TransactionalService> {
    const handle = await this.readTransaction(database)

    return new TransactionalService(handle, this.eventEmitter)
  }

  /**
  Open a transaction and return a TransactionalService
  (remember to call .commit() or .rollback())
  */
  async openWriteTransaction(database?: string): Promise<TransactionalService> {
    const handle = await this.writeTransaction(database)

    return new TransactionalService(handle, this.eventEmitter)
  }

  /**
  Run a unit of work within a READ transaction
  */
  async inReadTransaction<T>(
    work: (tx: TransactionalService) => Promise<T>,
    database?: string,
  ): Promise<T> {
    const tx = await this.openReadTransaction(database)

    try {
      return await work(tx)
    } catch (error) {
      return await rollbackAfterFailure(tx.getTransaction(), error)
    }
  }

  /**
  Run a unit of work within a WRITE transaction
  */
  async inWriteTransaction<T>(
    work: (tx: TransactionalService) => Promise<T>,
    database?: string,
  ): Promise<T> {
    const tx = await this.openWriteTransaction(database)

    try {
      return await work(tx)
    } catch (error) {
      return await rollbackAfterFailure(tx.getTransaction(), error)
    }
  }

  /**
  Run a batch of statements within ONE transaction (neode's batch()):
  begin, run every statement, then commit. On any failure the transaction
  is rolled back and a TransactionError is thrown, carrying the
  per-statement errors (aligned with the batch, null where a statement
  succeeded), the partial results and the failed statements' details.
  */
  async batch(
    queries: (string | { query: string; params?: QueryParameters })[],
    database?: string,
  ): Promise<QueryOutput[]> {
    const tx = await this.connection.beginTransaction('WRITE', database ?? this.database)

    const results: QueryOutput[] = []
    const errors: (BatchStatementError | null)[] = []
    const details: BatchStatementError[] = []

    // Every statement is attempted, so the error report covers the batch
    for (const [index, entry] of queries.entries()) {
      const query = typeof entry === 'string' ? entry : entry.query
      const parameters = (typeof entry === 'string' ? {} : entry.params) ?? {}

      try {
        results.push(await tx.run(query, parameters))
        errors.push(null)
      } catch (error) {
        const failed: BatchStatementError = { index, query, params: parameters, error }
        errors.push(failed)
        details.push(failed)
      }
    }

    if (details.length > 0) {
      return await rollbackAfterFailure(tx, new TransactionError(errors, results, details))
    }

    await tx.commit()

    return results
  }

  /**
  Run statements to create the schema
  */
  async installSchema(): Promise<SchemaResult[]> {
    const service = new SchemaService(this.connection, this.enterprise)

    return service.create()
  }

  /**
  Run statements to drop the schema
  */
  async dropSchema(): Promise<SchemaResult[]> {
    const service = new SchemaService(this.connection, this.enterprise)

    return service.drop()
  }

  /**
  Create a Repository
  */
  getRepository<Entity>(
    entity: new (...arguments_: never[]) => Entity,
    database?: string,
  ): Repository<Entity> {
    return resolveRepository(this, entity, database)
  }

  async find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string,
    database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

    try {
      const output = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).find<T>(constructor, schema, value)
        : await new FindService(tx).find(constructor, schema, value)

      await tx.commit()

      return output as T | undefined
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  async findById<T>(
    constructor: new (...arguments_: never[]) => T,
    elementId: string,
    database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

    try {
      const output = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).findById<T>(constructor, schema, elementId)
        : await new FindByIdService(tx).find(constructor, schema, elementId)

      await tx.commit()

      return output as T | undefined
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  async get<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown>,
    limit?: number,
    skip?: number,
    database?: string,
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

    try {
      const results = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).get<T>(constructor, schema, parameters, limit, skip)
        : await new GetService(tx).get<T>(constructor, schema, parameters, limit, skip)

      await tx.commit()

      return results
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  async getFirst<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown>,
    database?: string,
  ): Promise<T | undefined> {
    const records = await this.get<T>(constructor, parameters, 1, 0, database)

    return records[0]
  }

  /**
  Find the first node matching a key / value pair (or a property map),
  neode's Model.first(): sugar over getFirst()
  */
  async first<T>(
    constructor: new (...arguments_: never[]) => T,
    key: string | Record<string, unknown>,
    value?: unknown,
    database?: string,
  ): Promise<T | undefined> {
    const parameters = typeof key === 'object' ? key : { [key]: value }

    return this.getFirst<T>(constructor, parameters, database)
  }

  async save<T>(entity: T, database?: string): Promise<T> {
    const entityRecord = entity as unknown as Record<string, unknown>
    const schema = this.getSchema(entityRecord.constructor)

    const res = await this.inWriteTransaction(async (tx) => {
      const mergeService = new MergeService(tx.getRunner())

      const { elementId, created } = await mergeService.save(entity as object, schema)

      const findService = new FindByIdService(tx.getRunner())

      const hydrated = await findService.find(
        entityRecord.constructor as new (
          ...arguments_: never[]
        ) => T,
        getModel(entityRecord.constructor),
        elementId,
      )

      await tx.commit()

      return { hydrated: hydrated as T, created }
    }, database)

    // Emit the lifecycle event the save actually was: a merge either created
    // the node or matched and updated an existing one
    this.eventEmitter.emit(
      res.created ? EventType.NODE_CREATED : EventType.NODE_UPDATED,
      res.hydrated,
    )

    return res.hydrated
  }

  /**
  CREATE a new entity of the given constructor with the given properties
  (nested relationship targets included), then hydrate the created node
  */
  async create<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T> {
    const schema = this.getSchema(constructor)

    const tx = await this.writeTransaction(database)

    try {
      const entity = new constructor() as unknown as Record<string, unknown>

      Object.assign(entity, properties)

      const createService = new CreateService(tx)

      const { elementId } = await createService.create(schema, entity)

      const findService = new FindByIdService(tx)

      const hydrated = await findService.find(constructor, schema, elementId)

      if (!hydrated) {
        throw new Error('Entity was created but could not be found immediately afterwards')
      }

      await tx.commit()

      // Emit event
      this.eventEmitter.emit(EventType.NODE_CREATED, hydrated)

      return hydrated as T
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  MERGE a node on the given match properties, then set the given
  properties, hydrating the merged node
  */
  async mergeOn<T>(
    constructor: new (...arguments_: never[]) => T,
    match: Record<string, unknown>,
    set: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    const tx = await this.writeTransaction(database)

    try {
      const mergeService = new MergeService(tx)

      const output = await mergeService.mergeOn(schema, match, set)

      const firstRecord = output.records[0]

      if (firstRecord === undefined) {
        throw new Error('mergeOn returned no records')
      }

      const elementId = firstRecord.get(INTERNAL_ID)

      if (typeof elementId !== 'string') {
        throw new Error('mergeOn did not return an elementId')
      }

      const findService = new FindByIdService(tx)

      const hydrated = await findService.find(constructor, schema, elementId)

      await tx.commit()

      return hydrated as T | undefined
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  MERGE a node of the given constructor on its merge fields (the unique
  and indexed properties, neode's Model.merge): those present in
  `properties` form the match, everything else is set, with schema
  defaults resolving for properties not given
  */
  async merge<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    // Entity instances (or arrays of them) in the properties mean
    // relationship writes — those go through the save() path, which
    // already creates/relates nested relationships (neode's merge
    // semantics: "Neode will create relationships when either a Node
    // instance, ID property or Object containing match parameters
    // is passed")
    const hasRelationshipValues = schema.getRelationships().some((rel) => {
      const value = properties[rel.getKey()]

      if (value === undefined || value === null) {
        return false
      }

      return Array.isArray(value) ? value.length > 0 : typeof value === 'object'
    })

    if (hasRelationshipValues) {
      const entity = new constructor() as unknown as Record<string, unknown>
      Object.assign(entity, properties)

      return this.save(entity as T, database)
    }

    const mergeKeys = new Set(getMergeFields(schema).map((property) => property.getKey()))
    const entries = Object.entries(properties)

    return this.mergeOn<T>(
      constructor,
      Object.fromEntries(entries.filter(([key]) => mergeKeys.has(key))),
      Object.fromEntries(entries.filter(([key]) => !mergeKeys.has(key))),
      database,
    )
  }

  /**
  UPDATE the given properties on a node (`+=` semantics: provided keys
  only, matched by the entity's primary key), then re-hydrate it
  */
  async update<T>(
    entity: T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    const entityRecord = entity as unknown as Record<string, unknown>
    const schema = this.getSchema(entityRecord.constructor)

    const tx = await this.writeTransaction(database)

    try {
      await new UpdateService(tx).update(schema, entity as object, properties)

      const elementId = elementIdOfEntity(schema, entity as object)

      const hydrated = elementId
        ? await new FindByIdService(tx).find(
            entityRecord.constructor as new (
              ...arguments_: never[]
            ) => T,
            schema,
            elementId,
          )
        : undefined

      await tx.commit()

      return hydrated as T | undefined
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Relate two saved nodes, resolving the relationship by its KEY on the
  from-entity's schema (neode's node.relateTo(node, relationshipName)):
  MERGE the relationship, or CREATE with `forceCreate`
  */
  async relate<From extends object, To extends object>(
    constructor: new (...arguments_: never[]) => From,
    from: From,
    to: To,
    relationshipKey: string,
    properties: Record<string, unknown> = {},
    forceCreate = false,
    database?: string,
  ): Promise<GraphRelationship | undefined> {
    const schema = this.getSchema(constructor)
    const rel = this.resolveRelationship(schema, relationshipKey)

    const tx = await this.writeTransaction(database)

    try {
      const result = await new RelateService(tx).relate(
        schema,
        from,
        to,
        rel,
        properties,
        forceCreate,
      )

      await tx.commit()

      if (result) {
        this.eventEmitter.emit(
          forceCreate ? EventType.RELATIONSHIP_CREATED : EventType.RELATIONSHIP_MERGED,
          result,
        )
      }

      return result
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Remove the relationship of the given key between two nodes and return
  both re-hydrated
  */
  async detach<From extends object, To extends object>(
    constructor: new (...arguments_: never[]) => From,
    from: From,
    to: To,
    relationshipKey: string,
    database?: string,
  ): Promise<DetachResult<From, To>> {
    const schema = this.getSchema(constructor)
    const rel = this.requireRelationship(schema, relationshipKey)

    const tx = await this.writeTransaction(database)

    try {
      const result = await new DetachService(tx).detach(schema, from, to, rel)

      await tx.commit()

      return result
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  ALL nodes of the given constructor, optionally filtered by properties,
  ordered, limited and skipped (neode's all())
  */
  /**
  Full-text search over a full-text index (NTS-123): hydrated entities
  with their relevance score, best match first. Pass user text through
  `toFulltextQuery()` — the query is bound as a parameter, but Lucene
  syntax characters in it are still parsed as such.
  */
  async search<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    query: string,
    limit?: number,
  ): Promise<ScoredEntity<T>[]> {
    return search<T>(this.connection, constructor, indexName, query, limit)
  }

  /**
  k-nearest-neighbour search over a vector index (NTS-127): hydrated
  entities with their similarity score, best match first
  */
  async knn<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    vector: number[],
    k: number,
    mode?: KnnMode,
  ): Promise<ScoredEntity<T>[]> {
    return knn<T>(this.connection, constructor, indexName, vector, k, mode)
  }

  /**
  Agent-readable ontology over every registered model in JSON form
  (NTS-445) — entities with their labels, descriptions, properties and
  relationships, for LLM consumers
  */
  ontology(): Ontology {
    return ontology()
  }

  /**
  Agent-readable ontology over every registered model, rendered as
  prompt-ready markdown (NTS-445)
  */
  ontologyMarkdown(): string {
    return ontologyMarkdown()
  }

  /**
  Read the installed database schema (SHOW CONSTRAINTS / SHOW INDEXES)
  and diff it against the declared schema of the registered models
  (NTS-142)
  */
  async inspectSchema(options: InspectOptions = {}): Promise<SchemaInspection> {
    return inspectSchema(this.connection, { enterprise: this.enterprise, ...options })
  }

  /**
  Structured schema drift: the declared-vs-installed constraints and
  every index kind (range/text/fulltext/vector), each entry carrying
  the exact fix statement (NTS-450). Drift is data, not an error —
  this never throws on drift; failing a CI run on a non-empty diff is
  the caller's job.
  */
  async schemaDiff(options: InspectOptions = {}): Promise<SchemaDrift> {
    return schemaDrift(this.connection, { enterprise: this.enterprise, ...options })
  }

  /**
  Human-readable schema drift report, grouped by missing / stale /
  mismatched with the fix statement per line (NTS-450)
  */
  formatSchemaDiff(diff: SchemaDrift): string {
    return formatSchemaDrift(diff)
  }

  /**
  Apply the missing objects of a schema drift idempotently; stale
  objects are only dropped with `dropStale: true` (dropping is
  destructive). Reports each statement like installSchema (NTS-450)
  */
  async applySchemaDiff(
    diff: SchemaDrift,
    options: ApplySchemaDiffOptions = {},
  ): Promise<SchemaResult[]> {
    return applySchemaDrift(this.connection, diff, options)
  }

  /**
  Install the given full-text index definitions (NTS-123)
  */
  async installFulltextIndexes(definitions: FulltextIndexDefinition[]): Promise<SchemaResult[]> {
    return new FulltextIndexService(this.connection, definitions).create()
  }

  /**
  Drop the given full-text index definitions (NTS-123)
  */
  async dropFulltextIndexes(definitions: FulltextIndexDefinition[]): Promise<SchemaResult[]> {
    return new FulltextIndexService(this.connection, definitions).drop()
  }

  /**
  Install the given vector index definitions (NTS-127)
  */
  async installVectorIndexes(definitions: VectorIndexDefinition[]): Promise<SchemaResult[]> {
    return new VectorIndexService(this.connection, definitions).create()
  }

  /**
  Drop the given vector index definitions (NTS-127)
  */
  async dropVectorIndexes(definitions: VectorIndexDefinition[]): Promise<SchemaResult[]> {
    return new VectorIndexService(this.connection, definitions).drop()
  }

  /**
  CREATE every row in chunks of `UNWIND $rows ...` (NTS-126): one managed
  write transaction per chunk, rows validated like create() before the
  first write
  */
  async createMany<T>(
    constructor: new (...arguments_: never[]) => T,
    rows: Record<string, unknown>[] = [],
    options: BulkOptions = {},
    database?: string,
  ): Promise<BulkChunk<T>[]> {
    return new BulkService(this.connection).createMany<T>(
      constructor,
      this.getSchema(constructor),
      rows,
      { ...options, database },
    )
  }

  /**
  MERGE every row in chunks on the model's merge fields (NTS-126): one
  managed write transaction per chunk; every row must merge on the same
  merge fields
  */
  async mergeMany<T>(
    constructor: new (...arguments_: never[]) => T,
    rows: Record<string, unknown>[] = [],
    options: BulkOptions = {},
    database?: string,
  ): Promise<BulkChunk<T>[]> {
    return new BulkService(this.connection).mergeMany<T>(
      constructor,
      this.getSchema(constructor),
      rows,
      { ...options, database },
    )
  }

  /**
  Pagination helper (NTS-125). Offset mode — `{ page, limit, order? }` —
  returns `{ items, total, page, limit, totalPages }`; keyset mode —
  `{ limit, orderBy?, after?/before? }` — walks a temporal property and
  returns `{ items, nextCursor, hasMore }`
  */
  async paginate<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown>,
    options: OffsetPaginateOptions,
  ): Promise<Page<T>>
  async paginate<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown>,
    options: CursorPaginateOptions,
  ): Promise<CursorPage<T>>
  async paginate<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown> = {},
    options: OffsetPaginateOptions | CursorPaginateOptions = { limit: 25 },
  ): Promise<Page<T> | CursorPage<T>> {
    return new PaginateService(this.connection).paginate<T>(
      constructor,
      this.getSchema(constructor),
      filter,
      options,
    )
  }

  /**
  Run a semicolon-split Cypher script sequentially (NTS-134), one
  autocommit statement at a time, fail-fast
  */
  async runCypherScript(
    content: string,
    options: RunCypherScriptOptions = {},
  ): Promise<QueryOutput[]> {
    return runCypherScript(this.getRunner(), content, options)
  }

  async all<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

    try {
      const results = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).get<T>(
            constructor,
            schema,
            parameters,
            limit,
            skip,
            order,
          )
        : await new GetService(tx).get<T>(constructor, schema, parameters, limit, skip, order)

      await tx.commit()

      return results
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Nodes of the given constructor within `distance` of the given point,
  ordered by distance when `order` is 'distance'
  (neode's FindWithinDistance)
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
    database?: string,
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

    try {
      const results = await new WithinDistanceService(tx).withinDistance<T>(
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

      await tx.commit()

      return results
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  A factory builder for seeding fake data (NTS-444): chain `.count(n)`,
  `.with(relationshipName, { count, properties })` and
  `.create(overrides)`. Accepts a model name (map-defined via model()
  / with()) or a decorated model class.
  */
  factory<T extends object>(model: new (...arguments_: never[]) => T): FactoryBuilder<T>
  factory(model: string | Newable): FactoryBuilder
  factory(model: string | Newable): FactoryBuilder {
    return new FactoryBuilder(this, model)
  }

  /**
  Define a model from a map-based schema definition (neode parity), or,
  when no schema is given, look up a previously defined model by name.
  */
  model(name: string, schema?: SchemaDefinition): Newable {
    if (schema) {
      return defineModel(name, schema)
    }

    const existing = getModelByName(name)

    if (!existing) {
      throw new Error(unknownDefinitionError(name))
    }

    return existing
  }

  /**
  Define multiple models at once: { Name: schemaDefinition }
  */
  with(models: Record<string, SchemaDefinition>): this {
    for (const [name, schema] of Object.entries(models)) {
      this.model(name, schema)
    }

    return this
  }

  /**
  Scan a directory and register each module's default export as a model
  named after the file (neode parity, extended to .ts files)
  */
  withDirectory(directory: string): this {
    const requireModule = createRequire(__filename)

    for (const file of readdirSync(directory).filter((file) =>
      ['.js', '.ts'].includes(extname(file).toLowerCase()),
    )) {
      const name = basename(file, extname(file))
      const loaded = requireModule(resolve(directory, file)) as {
        default?: SchemaDefinition
      }

      this.model(name, loaded.default ?? (loaded as SchemaDefinition))
    }

    return this
  }

  /**
  neode's extend(): clone a model under a new name, adding the new name
  as an extra label, with the given schema merged on top
  */
  extend(name: string, as: string, schema?: SchemaDefinition): Newable {
    return extendModel(name, as, schema)
  }

  /**
  Delete a node. `options` threads the cascade modes through to the
  delete service; the legacy form `delete(entity, database)` — a string
  second argument, as accepted by INeode — is kept working.
  */
  async delete<T>(entity: T, options?: DeleteOptions | string, database?: string): Promise<void> {
    const schema = this.getSchema((entity as unknown as Record<string, unknown>).constructor)

    // A soft delete only SETs a label — the node stays, so it is not a
    // deletion and must not fire NODE_DELETED
    const deleteOptions = typeof options === 'string' ? undefined : options

    const tx = await this.writeTransaction(typeof options === 'string' ? options : database)

    try {
      await new DeleteService(tx).delete(schema, entity as object, deleteOptions)

      await tx.commit()
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }

    if (!deleteOptions?.soft) {
      // Emit event
      this.eventEmitter.emit(EventType.NODE_DELETED, entity)
    }
  }

  /**
  DETACH DELETE every node of the given constructor matching the given
  properties, returning the deleted count (neode's Model.deleteAll,
  extended with a count return)
  */
  async deleteAll<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters_: Record<string, unknown> = {},
    database?: string,
  ): Promise<number> {
    const schema = this.getSchema(constructor)

    const builder = new Builder().match('n', schema.getLabels())

    // Schema-declared keys only (get() parity): anything else would be raw
    // interpolation into the statement, so unknown keys are ignored
    for (const property of schema.getProperties()) {
      const key = property.getKey()

      if (Object.hasOwn(parameters_, key)) {
        builder.where(`n.${quote(key)}`, parameters_[key])
      }
    }

    const { query, params: parameters } = builder
      .detachDelete('n')
      .return('count(n) AS count')
      .build()

    const output = await this.writeCypher(query, parameters, database)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new Error('count query returned no records')
    }

    return Number(firstRecord.get('count'))
  }

  /**
  Return a new query Builder (neode parity): chain
  `.execute(neode.getConnection())` to run the built statement
  */
  query(): Builder {
    return new Builder()
  }

  /**
  Close the underlying connection (neode parity)
  */
  async close(): Promise<void> {
    return this.connection.close()
  }
}
