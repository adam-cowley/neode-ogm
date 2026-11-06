import Neode from './neode.service';
export default Neode;

export { EventType } from './common/events';
export { fromEnv } from './utils';
export { default as Repository } from './repository';
export { default as TransactionalService } from './transaction/transactional.service';
export { registerRepository, getRepository } from './meta';
export { default as Collection } from './collection';
export { toJson, valueToJson } from './serialise';

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
