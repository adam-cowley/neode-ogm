import Neode from './neode.service';
export default Neode;

export { EventType } from './common/events';
export { fromEnv } from './utils';
export {
    NeodeError,
    ConstraintViolationError,
    TransientError,
    classifyError,
    isTransientError,
} from './errors';
export { default as Repository } from './repository';
export { default as TransactionalService } from './transaction/transactional.service';
export { registerRepository, getRepository, resolveRepository } from './meta';
export { mergeRelationshipProperty } from './meta';
export type { RepositoryConstructor } from './meta';
export { default as Collection } from './collection';
export { toJson, valueToJson } from './serialise';

// Active-record instance methods on hydrated entities (P7.2)
export { applyEntityMethods, setDefaultNeode } from './entity-methods';
export type { EntityMethods, WithMethods } from './entity-methods';

// Map-based schema definitions
export {
    defineModel,
    extendModel,
    getModelByName,
    getModelsByName,
} from './meta/map-schema';
export type {
    PropertyTypeName,
    PropertyDefinition,
    RelationshipDefinition,
    SchemaDefinition,
    SchemaDefinitionEntry,
} from './meta/schema-definition.interface';

// Query builder
export { Builder, Direction, toDirection } from './query';

// Hydration of raw query results (P4.11 parity)
export { hydrate, hydrateFirst, toCollection } from './hydrate';

// Database drivers
export {
    ConnectionProvider,
    TransactionHandle,
    Runner,
    QueryOutput,
    QueryRecord,
    QueryParams,
    QuerySummary,
    CypherOptions,
    ConnectionOptions,
    GraphNode,
    GraphRelationship,
    AccessMode,
} from './driver/types';
export { Neo4jConnectionProvider } from './driver/neo4j';
export { RelateConnectionProvider } from './driver/relate';

// Raw-cypher helpers + instrumented provider (NTS-122/124/132/133)
export { jsonSafe, jsonSafeRecord } from './driver/json-safe';
export { instrumentConnectionProvider } from './driver/instrumented';
export type { QueryExecutedEvent } from './common/events';

// Read-model projections (NTS-135/136/137/138)
export {
    ProjectionService,
    projectionNode,
    hasProjectedProperties,
    hydrateProjection,
} from './projection';
export type {
    RelatedOneDefinition,
    RelatedManyDefinition,
    RelationshipCountDefinition,
    RelationshipExistsDefinition,
    LabelPresentDefinition,
    ExpressionDefinition,
    ComputedDefinition,
} from './meta/schema-definition.interface';

// Full-text + vector search (NTS-123/127)
export { search } from './services/query/search.service';
export type { ScoredEntity } from './services/query/search.service';
export { knn } from './services/query/knn.service';
export type { KnnMode } from './services/query/knn.service';
export { toFulltextQuery } from './services/index-support/lucene';
export { default as FulltextIndexService } from './services/schema/fulltext.service';
export type { FulltextIndexDefinition } from './services/schema/fulltext.service';
export { default as VectorIndexService } from './services/schema/vector.service';
export type { VectorIndexDefinition } from './services/schema/vector.service';
export { inspectSchema } from './services/schema/inspect.service';
export type {
    SchemaInspection,
    SchemaDiff,
    SchemaObject,
    InspectOptions,
} from './services/schema/inspect.service';

// Bulk writes + pagination (NTS-125/126)
export { default as BulkService } from './services/query/bulk.service';
export type { BulkChunk, BulkOptions } from './services/query/bulk.service';
export { default as PaginateService } from './services/query/paginate.service';
export type {
    Page,
    CursorPage,
    PaginateOptions,
    OffsetPaginateOptions,
    CursorPaginateOptions,
} from './services/query/paginate.service';

// Ops helpers + consumer test utilities (NTS-130/134/146)
export {
    verifyConnectivity,
    waitUntilReachable,
    ConnectivityTimeoutError,
    splitCypherStatements,
    runCypherScript,
} from './ops';
export type {
    ConnectivityConfig,
    WaitUntilReachableOptions,
    RunCypherScriptOptions,
} from './ops';
export { wipe, testId } from './testing';
export type { WipeTarget } from './testing';

// Query builder additions (NTS-143/144/128)
export { WhereNull, LabelPredicate } from './query';

export * from './decorators';
