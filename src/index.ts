import Neode from './neode.service';
export default Neode;

export { EventType } from './common/events';
export { fromEnv } from './utils';
export { default as Repository } from './repository';
export { default as TransactionalService } from './transaction/transactional.service';
export { registerRepository, getRepository, resolveRepository } from './meta';
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
    GraphNode,
    GraphRelationship,
    AccessMode,
} from './driver/types';
export { Neo4jConnectionProvider } from './driver/neo4j';
export { RelateConnectionProvider } from './driver/relate';

export * from './decorators';
