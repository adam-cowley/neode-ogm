import type { DefaultValue } from './property-schema.js'

/**
neode-compatible property type names for map-based schema definitions.

Unknown names fall back to `any` (neode treats them as Joi hints; the OGM
has no validation pass so they carry no behaviour).
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
  | 'duration'

/**
Full form property definition, mirroring neode's schema object options.
*/
export interface PropertyDefinition {
  type: PropertyTypeName
  /**
  Free-text explanation of the property for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
  array?: boolean
  default?: DefaultValue
  primary?: boolean
  /**
  boolean: single-property unique constraint.
  string[]: composite unique covering exactly the listed properties
  (NTS-140) — declared on one property, the array is the full composite.
  */
  unique?: boolean | string[]
  onCreateSet?: boolean
  onMatchSet?: boolean
  alwaysSet?: boolean
  required?: boolean
  hidden?: boolean
  protected?: boolean
  readonly?: boolean
  /**
  boolean: single-property index.
  string[]: composite index covering exactly the listed properties (NTS-140).
  */
  index?: boolean | string[]
  exists?: boolean
  /**
  Opt in to a property-type constraint generated from the declared type (NTS-141): `REQUIRE n.prop IS :: STRING`.
  */
  typed?: boolean
  /** Declare a full-text index over the property (NTS-123/436). */
  fulltext?: boolean
  /**
  Read-side fallbacks applied at hydration when the stored/projected
  value is null or absent (NTS-139, the Zod `.catch()` analogue): a
  literal, or sibling property names whose first non-null value wins.
  */
  coalesce?: string | string[]
  /**
  Per-property fake data generator (NTS-444): user-supplied, no faker
  dependency. Invoked by factory seeding (and the create path) when
  neither an explicit value nor `default` applies — precedence on
  create is explicit value > `default` > `fake`, and generated values
  are validated like any other write.
  */
  fake?: () => unknown
}

/**
Relationship definition, mirroring neode's relationship schema entries.

`type` uses neode's singular/plural spellings ('relationship'/'node' for
one, 'relationships'/'nodes' for many).
*/
export interface RelationshipDefinition {
  type: 'relationship' | 'relationships' | 'node' | 'nodes'
  /**
  Free-text explanation of the relationship for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
  /**
  Neo4j relationship type, e.g. 'KNOWS'
  */
  relationship: string
  /**
  'in' | 'out' | 'both' (case-insensitive, invalid falls back to both)
  */
  direction: string
  /**
  Name of the model this relationship points at
  */
  target: string
  /**
  shortcut: edge properties are parsed but not wired yet — needs a generated relationship entity; add when edge-property saves are needed
  */
  properties?: Record<string, PropertyTypeName | PropertyDefinition>
  eager?: boolean
}

/**
Read-model projection definitions (NTS-135/136/137/138) — the map-based
API for @RelatedOne / @RelatedMany / @RelationshipCount /
@RelationshipExists / @LabelPresent / @Expression / @Computed.
*/

/**
@RelatedOne: `fields` omitted = full-entity eager loading
*/
export interface RelatedOneDefinition {
  type: 'relatedOne'
  relationship: string
  direction?: string
  target?: string
  fields?: string[]
}

/**
@RelatedMany: a single-field subset projects a scalar array
*/
export interface RelatedManyDefinition {
  type: 'relatedMany'
  relationship: string
  direction?: string
  target?: string
  fields?: string[]
}

/**
@RelationshipCount: multi-type via pipe ('A|B'); `where` uses `node` for the target node
*/
export interface RelationshipCountDefinition {
  type: 'relationshipCount'
  relationship: string
  direction?: string
  target?: string
  where?: string
  minHops?: number
  maxHops?: number
}

/**
@RelationshipExists: `EXISTS { }` boolean
*/
export interface RelationshipExistsDefinition {
  type: 'relationshipExists'
  relationship: string
  direction?: string
  where?: string
}

/**
@LabelPresent: true when the node carries the label
*/
export interface LabelPresentDefinition {
  type: 'labelPresent'
  label: string
}

/**
@Expression: raw Cypher projected into the read query (root node is `this`)
*/
export interface ExpressionDefinition {
  type: 'expression'
  expression: string
}

/**
@Computed: derived in TypeScript after hydration
*/
export interface ComputedDefinition {
  type: 'computed'
  compute: (entity: any) => unknown
}

export type ProjectionDefinition =
  | RelatedOneDefinition
  | RelatedManyDefinition
  | RelationshipCountDefinition
  | RelationshipExistsDefinition
  | LabelPresentDefinition
  | ExpressionDefinition
  | ComputedDefinition

export type SchemaDefinitionEntry =
  | PropertyTypeName
  | PropertyDefinition
  | RelationshipDefinition
  | ProjectionDefinition

/**
Map-based schema definition for a model (neode parity).

Every key except `labels` defines a property or relationship. Property
values may be shorthand type names (`age: 'number'`) or full definitions.
*/
export interface SchemaDefinition {
  labels?: string[]
  /**
  Free-text explanation of the model for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
  [key: string]: SchemaDefinitionEntry | string[] | string | undefined
}
