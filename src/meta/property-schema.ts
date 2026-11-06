import { Newable } from '../meta/newable'
import EntitySchema from './entity/entity-schema'

export enum PropertyType {
  ANY,
  INTERNAL_ID,
  ALL_PROPERTIES,
  UUID,
  STRING,
  INTEGER,

  // Numbers
  FLOAT,
  NUMBER,

  BOOLEAN,

  // Temporal
  DATE,
  TIME,
  DATETIME,
  LOCALTIME,
  LOCALDATETIME,

  // Spatial
  POINT,

  // Durations
  DURATION,

  // Relationships
  ONE_TO_ONE,
  ONE_TO_MANY,

  // Read-model projections (NTS-135/136/137/138): composed into the RETURN
  // map projection of the read query — one Cypher query per read
  RELATED_ONE,
  RELATED_MANY,
  RELATIONSHIP_COUNT,
  RELATIONSHIP_EXISTS,
  LABEL_PRESENT,
  COMPUTED,
  EXPRESSION,

  START_NODE,
  END_NODE,
  OTHER_NODE,

  NODE,
  RELATIONSHIP,
}

/**
 * Property types that project read-model values: RELATED_ONE / RELATED_MANY
 * eager subsets, RELATIONSHIP_COUNT, RELATIONSHIP_EXISTS, LABEL_PRESENT and
 * EXPRESSION compose extra reads into the RETURN projection;
 * COMPUTED derives a value in TypeScript after hydration.
 * Any of these on a model means reads must go through the projection path.
 */
export const ProjectedPropertyTypes = [
  PropertyType.RELATED_ONE,
  PropertyType.RELATED_MANY,
  PropertyType.RELATIONSHIP_COUNT,
  PropertyType.RELATIONSHIP_EXISTS,
  PropertyType.LABEL_PRESENT,
  PropertyType.EXPRESSION,
  PropertyType.COMPUTED,
]

/** Property types that map onto Neo4j temporal values */
export const TemporalTypes = [
  PropertyType.DATE,
  PropertyType.TIME,
  PropertyType.DATETIME,
  PropertyType.LOCALTIME,
  PropertyType.LOCALDATETIME,
]

export const RelationshipTypes = [PropertyType.ONE_TO_ONE, PropertyType.ONE_TO_ONE]

export type DefaultValue = (model: object, schema: EntitySchema) => any | any | undefined

export default class PropertySchema {
  private type: PropertyType = PropertyType.ANY
  private defaultValue: DefaultValue

  private primaryKey: boolean = false
  private unique: boolean = false
  private array: boolean = false
  private required: boolean = false
  private hidden: boolean = false
  private protectedOption: boolean = false
  private readOnly: boolean = false
  private index: boolean = false
  private exists: boolean = false
  private onCreateSet: boolean = false
  private onMatchSet: boolean = false
  private alwaysSet: boolean = false

  private entity: Newable

  /** neode validation rules (min, max, email, regex, …) beyond the metamodel flags */
  private rules: Record<string, unknown> = {}

  constructor(private readonly key: string) {}

  getKey(): string {
    return this.key
  }

  setType(type: PropertyType) {
    this.type = type
  }

  getType(): PropertyType {
    return this.type
  }

  setArray(value: boolean = true) {
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

  setPrimaryKey(value: boolean = true) {
    this.primaryKey = value
    this.unique = value
  }

  isPrimaryKey() {
    return this.primaryKey
  }

  setUnique(value: boolean = true) {
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

  /** Read-side fallbacks at hydration (NTS-139): a literal, or sibling property names (first non-null wins) */
  private coalesce: string | string[] | undefined

  /** Opt in to a property-type constraint generated from the declared type (NTS-141) */
  private typed: boolean = false

  /** Composite unique constraint properties (NTS-140): the full composite, declared on one property */
  private compositeUnique: string[] | undefined

  /** Composite index properties (NTS-140): the full composite, declared on one property */
  private compositeIndex: string[] | undefined

  setCoalesce(coalesce: string | string[]) {
    this.coalesce = coalesce
  }

  getCoalesce() {
    return this.coalesce
  }

  setTyped(value: boolean = true) {
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

  setEntity(entity: Newable) {
    this.entity = entity
  }

  getEntity() {
    return this.entity
  }

  /** Merge the given rules over any previously stored ones */
  setRules(rules: Record<string, unknown>) {
    this.rules = { ...this.rules, ...rules }
  }

  getRules() {
    return this.rules
  }

  // ---- Read-model projection configuration (NTS-135/136/137/138) ----

  /** @RelatedOne / @RelatedMany: relationship type, e.g. 'IN_COURSE' ('A|B' allowed) */
  private relationshipType: string | undefined

  /** @RelatedOne / @RelatedMany: field subset; undefined = full-entity eager loading */
  private fields: string[] | undefined

  /** @RelatedOne / @RelatedMany / @RelationshipCount / @RelationshipExists direction */
  private projectionDirection: import('../query').Direction | undefined

  /** WHERE fragment inside COUNT { } / EXISTS { }; `node` is the target node */
  private where: string | undefined

  /** @RelationshipCount variable-length hop bounds */
  private minHops: number | undefined
  private maxHops: number | undefined

  /** @LabelPresent: the label tested for */
  private label: string | undefined

  /** @Expression: raw Cypher projected into the read query */
  private expression: string | undefined

  /** @Computed: derives the value in TypeScript after hydration */
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

  setDirection(direction: import('../query').Direction) {
    this.projectionDirection = direction
  }

  getDirection(): import('../query').Direction | undefined {
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

/** True when the property projects a read-model value (see ProjectedPropertyTypes) */
export function isProjectedProperty(property: PropertySchema): boolean {
  return ProjectedPropertyTypes.includes(property.getType())
}
