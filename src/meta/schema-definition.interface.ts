import { DefaultValue } from './property-schema';

/**
 * neode-compatible property type names for map-based schema definitions.
 *
 * Unknown names fall back to `any` (neode treats them as Joi hints; the OGM
 * has no validation pass so they carry no behaviour).
 */
export type PropertyTypeName =
    | 'any'
    | 'string'
    | 'number'
    | 'int'
    | 'integer'
    | 'float'
    | 'boolean'
    | 'uuid'
    | 'date'
    | 'time'
    | 'datetime'
    | 'localtime'
    | 'localdatetime'
    | 'point'
    | 'duration';

/**
 * Full form property definition, mirroring neode's schema object options.
 */
export interface PropertyDefinition {
    type: PropertyTypeName;
    array?: boolean;
    default?: DefaultValue;
    primary?: boolean;
    unique?: boolean;
    onCreateSet?: boolean;
    onMatchSet?: boolean;
    alwaysSet?: boolean;
    required?: boolean;
    hidden?: boolean;
    protected?: boolean;
    readonly?: boolean;
    index?: boolean;
    exists?: boolean;
}

/**
 * Relationship definition, mirroring neode's relationship schema entries.
 *
 * `type` uses neode's singular/plural spellings ('relationship'/'node' for
 * one, 'relationships'/'nodes' for many).
 */
export interface RelationshipDefinition {
    type: 'relationship' | 'relationships' | 'node' | 'nodes';
    /** Neo4j relationship type, e.g. 'KNOWS' */
    relationship: string;
    /** 'in' | 'out' | 'both' (case-insensitive, invalid falls back to both) */
    direction: string;
    /** Name of the model this relationship points at */
    target: string;
    /** shortcut: edge properties are parsed but not wired yet — needs a generated relationship entity; add when edge-property saves are needed */
    properties?: Record<string, PropertyTypeName | PropertyDefinition>;
    eager?: boolean;
}

export type SchemaDefinitionEntry =
    | PropertyTypeName
    | PropertyDefinition
    | RelationshipDefinition;

/**
 * Map-based schema definition for a model (neode parity).
 *
 * Every key except `labels` defines a property or relationship. Property
 * values may be shorthand type names (`age: 'number'`) or full definitions.
 */
export interface SchemaDefinition {
    labels?: string[];
    [key: string]: SchemaDefinitionEntry | string[] | undefined;
}
