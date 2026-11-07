import type { Newable } from '../meta/newable.js'
import type EntitySchema from './entity/entity-schema.js'

export const PropertyType = {
  ANY: 0,
  INTERNAL_ID: 1,
  ALL_PROPERTIES: 2,
  UUID: 3,
  STRING: 4,
  INTEGER: 5,

  // Numbers
  FLOAT: 6,
  NUMBER: 7,

  BOOLEAN: 8,

  // Temporal
  DATE: 9,
  TIME: 10,
  DATETIME: 11,
  LOCALTIME: 12,
  LOCALDATETIME: 13,

  // Spatial
  POINT: 14,

  // Durations
  DURATION: 15,

  // Relationships
  ONE_TO_ONE: 16,
  ONE_TO_MANY: 17,

  // Read-model projections (NTS-135/136/137/138): composed into the RETURN
  // map projection of the read query — one Cypher query per read
  RELATED_ONE: 18,
  RELATED_MANY: 19,
  RELATIONSHIP_COUNT: 20,
  RELATIONSHIP_EXISTS: 21,
  LABEL_PRESENT: 22,
  COMPUTED: 23,
  EXPRESSION: 24,

  START_NODE: 25,
  END_NODE: 26,
  OTHER_NODE: 27,

  NODE: 28,
  RELATIONSHIP: 29,
} as const

export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType]

/**
Property types that project read-model values: RELATED_ONE / RELATED_MANY
eager subsets, RELATIONSHIP_COUNT, RELATIONSHIP_EXISTS, LABEL_PRESENT and
EXPRESSION compose extra reads into the RETURN projection;
COMPUTED derives a value in TypeScript after hydration.
Any of these on a model means reads must go through the projection path.
*/
export const ProjectedPropertyTypes: PropertyType[] = [
  PropertyType.RELATED_ONE,
  PropertyType.RELATED_MANY,
  PropertyType.RELATIONSHIP_COUNT,
  PropertyType.RELATIONSHIP_EXISTS,
  PropertyType.LABEL_PRESENT,
  PropertyType.EXPRESSION,
  PropertyType.COMPUTED,
]

/**
Property types that map onto Neo4j temporal values
*/
export const TemporalTypes: PropertyType[] = [
  PropertyType.DATE,
  PropertyType.TIME,
  PropertyType.DATETIME,
  PropertyType.LOCALTIME,
  PropertyType.LOCALDATETIME,
]

export type DefaultValue = (model: object, schema: EntitySchema) => any | undefined

export default class PropertySchema {
  private type: PropertyType = PropertyType.ANY
  private defaultValue!: DefaultValue

  private primaryKey = false
  private unique = false
  private array = false
  private required = false
  private hidden = false
  private protectedOption = false
  private readOnly = false
  private index = false
  private exists = false
  private onCreateSet = false
  private onMatchSet = false
  private alwaysSet = false
  private fulltext = false

  /**
  Free-text explanation emitted by the agent ontology (NTS-445)
  */
  private description: string | undefined

  private entity!: Newable

  /**
  neode validation rules (min, max, email, regex, …) beyond the metamodel flags
  */
  private rules: Record<string, unknown> = {}

  private readonly key: string

  constructor(key: string) {
    this.key = key
  }

  getKey(): string {
    return this.key
  }

  setType(type: PropertyType) {
    this.type = type
  }

  getType(): PropertyType {
    return this.type
  }

  setArray(value = true) {
    this.array = value
  }

  isArray() {
    return this.array
  }

  setDefaultValue(value: DefaultValue) {
    this.defaultValue = value
  }

  getDefaultValue() {
    return this.defaultValue
  }

  setPrimaryKey(value = true) {
    this.primaryKey = value
    this.unique = value
  }

  isPrimaryKey() {
    return this.primaryKey
  }

  setUnique(value = true) {
    this.unique = value
  }

  isUnique() {
    return this.unique
  }

  setRequired(value = true) {
    this.required = value
  }

  isRequired() {
    return this.required
  }

  setHidden(value = true) {
    this.hidden = value
  }

  isHidden() {
    return this.hidden
  }

  setProtected(value = true) {
    this.protectedOption = value
  }

  isProtected() {
    return this.protectedOption
  }

  setReadonly(value = true) {
    this.readOnly = value
  }

  isReadonly() {
    return this.readOnly
  }

  setIndex(value = true) {
    this.index = value
  }

  isIndex() {
    return this.index
  }

  setExists(value = true) {
    this.exists = value
  }

  isExists() {
    return this.exists
  }

  // ---- Hydration + schema-sync config (NTS-139/140/141) ----

  /**
  Read-side fallbacks at hydration (NTS-139): a literal, or sibling property names (first non-null wins)
  */
  private coalesce: string | string[] | undefined

  /**
  Opt in to a property-type constraint generated from the declared type (NTS-141)
  */
  private typed = false

  /**
  Composite unique constraint properties (NTS-140): the full composite, declared on one property
  */
  private compositeUnique: string[] | undefined

  /**
  Composite index properties (NTS-140): the full composite, declared on one property
  */
  private compositeIndex: string[] | undefined

  /**
  Per-property fake data generator (NTS-444): user-supplied, no faker
  dependency. Invoked on the create path when neither an explicit value
  nor `default` applies (precedence: explicit > default > fake).
  */
  private fake: (() => unknown) | undefined

  setCoalesce(coalesce: string | string[]) {
    this.coalesce = coalesce
  }

  getCoalesce() {
    return this.coalesce
  }

  setTyped(value = true) {
    this.typed = value
  }

  isTyped() {
    return this.typed
  }

  setCompositeUnique(properties: string[]) {
    this.compositeUnique = properties
  }

  getCompositeUnique() {
    return this.compositeUnique
  }

  setCompositeIndex(properties: string[]) {
    this.compositeIndex = properties
  }

  getCompositeIndex() {
    return this.compositeIndex
  }

  setFake(fake: () => unknown) {
    this.fake = fake
  }

  getFake() {
    return this.fake
  }

  setOnCreateSet(value = true) {
    this.onCreateSet = value
  }

  getOnCreateSet() {
    return this.onCreateSet
  }

  setOnMatchSet(value = true) {
    this.onMatchSet = value
  }

  getOnMatchSet() {
    return this.onMatchSet
  }

  setAlwaysSet(value = true) {
    this.alwaysSet = value
  }

  getAlwaysSet() {
    return this.alwaysSet
  }

  setFulltext(value = true) {
    this.fulltext = value
  }

  getFulltext() {
    return this.fulltext
  }

  setDescription(description: string) {
    this.description = description
  }

  getDescription() {
    return this.description
  }

  setEntity(entity: Newable) {
    this.entity = entity
  }

  getEntity() {
    return this.entity
  }

  /**
  Merge the given rules over any previously stored ones
  */
  setRules(rules: Record<string, unknown>) {
    this.rules = { ...this.rules, ...rules }
  }

  getRules() {
    return this.rules
  }

  // ---- Read-model projection configuration (NTS-135/136/137/138) ----

  /**
  @RelatedOne / @RelatedMany: relationship type, e.g. 'IN_COURSE' ('A|B' allowed)
  */
  private relationshipType: string | undefined

  /**
  @RelatedOne / @RelatedMany: field subset; undefined = full-entity eager loading
  */
  private fields: string[] | undefined

  /**
  @RelatedOne / @RelatedMany / @RelationshipCount / @RelationshipExists direction
  */
  private projectionDirection: import('../query/index.js').Direction | undefined

  /**
  WHERE fragment inside COUNT { } / EXISTS { }; `node` is the target node
  */
  private where: string | undefined

  /**
  @RelationshipCount variable-length hop bounds
  */
  private minHops: number | undefined
  private maxHops: number | undefined

  /**
  @LabelPresent: the label tested for
  */
  private label: string | undefined

  /**
  @Expression: raw Cypher projected into the read query
  */
  private expression: string | undefined

  /**
  @Computed: derives the value in TypeScript after hydration
  */
  private compute: ((entity: any) => unknown) | undefined

  setRelationshipType(relationshipType: string) {
    this.relationshipType = relationshipType
  }

  getRelationshipType() {
    return this.relationshipType
  }

  setFields(fields: string[]) {
    this.fields = fields
  }

  getFields() {
    return this.fields
  }

  setDirection(direction: import('../query/index.js').Direction) {
    this.projectionDirection = direction
  }

  getDirection(): import('../query/index.js').Direction | undefined {
    return this.projectionDirection
  }

  setWhere(where: string) {
    this.where = where
  }

  getWhere() {
    return this.where
  }

  setMinHops(minHops: number) {
    this.minHops = minHops
  }

  getMinHops() {
    return this.minHops
  }

  setMaxHops(maxHops: number) {
    this.maxHops = maxHops
  }

  getMaxHops() {
    return this.maxHops
  }

  setLabel(label: string) {
    this.label = label
  }

  getLabel() {
    return this.label
  }

  setExpression(expression: string) {
    this.expression = expression
  }

  getExpression() {
    return this.expression
  }

  setCompute(compute: (entity: any) => unknown) {
    this.compute = compute
  }

  getCompute() {
    return this.compute
  }
}

/**
True when the property projects a read-model value (see ProjectedPropertyTypes)
*/
export function isProjectedProperty(property: PropertySchema): boolean {
  return ProjectedPropertyTypes.includes(property.getType())
}
