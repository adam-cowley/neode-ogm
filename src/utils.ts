import type EntitySchema from './meta/entity/entity-schema.js'
import type PropertySchema from './meta/property-schema.js'
import { PropertyType } from './meta/property-schema.js'
import { ELEMENT_ID } from './constants.js'
/**
The elementId carried by a hydrated entity: the runtime stash written by
hydration (every persisted entity has one), or the deprecated @InternalId
property for entities hydrated before it existed. Undefined for entities
that have never been persisted.
*/
export function elementIdOfEntity(schema: EntitySchema, entity: object): string | undefined {
  const stashed = (entity as Record<symbol, unknown>)[ELEMENT_ID]

  if (typeof stashed === 'string' && stashed.length > 0) {
    return stashed
  }

  const internalId = schema
    .getProperties()
    .find((property) => property.getType() === PropertyType.INTERNAL_ID)

  const viaProperty = internalId
    ? (entity as Record<string, unknown>)[internalId.getKey()]
    : undefined

  return typeof viaProperty === 'string' && viaProperty.length > 0 ? viaProperty : undefined
}

/**
Match criteria for an entity in a write query: prefer the hydrated
elementId (stable, always present on persisted entities), falling back to
the primary key property value (neode matched instances by internal id;
elementId is its modern, portable equivalent).
*/
export function matchCriteriaForEntity(
  schema: EntitySchema,
  entity: object,
): { elementId?: string; key: string; value: unknown } {
  const pk = schema.getPrimaryKey()
  const elementId = elementIdOfEntity(schema, entity)

  if (elementId) {
    // key / value describe the pk fallback match, used only when the
    // caller cannot match by elementId
    return {
      elementId,
      key: pk?.getKey() ?? '',
      value: pk ? (entity as Record<string, unknown>)[pk.getKey()] : undefined,
    }
  }

  if (!pk) {
    throw new Error('Cannot match an entity with no primary key and no elementId')
  }

  const value = (entity as Record<string, unknown>)[pk.getKey()]

  if (value === undefined) {
    throw new Error(
      `Cannot match an entity without a primary key value for "${pk.getKey()}". Did you save it first?`,
    )
  }

  return { key: pk.getKey(), value }
}

export function getValuesAsRecord(
  model: object,
  properties: PropertySchema[],
  _schema: EntitySchema,
): Record<string, unknown> {
  return Object.fromEntries(
    properties
      .map((property) => {
        const key = property.getKey()

        // Merge matching only uses explicitly-set values:
        // resolving defaults here would generate a new value
        // (e.g. a fresh UUID) on every save and never match
        if (Object.hasOwn(model, key)) {
          const value = (model as Record<string, unknown>)[key]

          if (value !== undefined) {
            return [key, value]
          }
        }

        return
      })
      .filter((entry) => entry !== undefined),
  )
}

export function getValueOrDefault(
  model: object,
  property: PropertySchema,
  schema: EntitySchema,
): unknown {
  const key = property.getKey()

  if (Object.hasOwn(model, key) && (model as Record<string, unknown>)[key] !== undefined) {
    return (model as Record<string, unknown>)[key]
  }

  const defaultValue = property.getDefaultValue()

  return typeof defaultValue === 'function' ? defaultValue(model, schema) : defaultValue
}

/**
Set a property on the builder following the property's write config:
nullish values REMOVE the property, primary keys and onCreateSet-only
properties are written with ON CREATE SET, onMatchSet properties with
ON MATCH SET, everything else unconditionally.
*/
export function setPropertyInBuilder(
  builder: import('./query/index.js').default,
  alias: string,
  property: PropertySchema,
  value: unknown,
): import('./query/index.js').default {
  if (value === undefined || value === null) {
    return builder.delete(`${alias}.${property.getKey()}`)
  }

  // Ignore Internal IDs, properties and nodes
  if (
    property.getType() === PropertyType.INTERNAL_ID ||
    property.getType() === PropertyType.ALL_PROPERTIES ||
    property.getType() === PropertyType.NODE
  ) {
    return builder
  }

  // TODO: Handle complex types (temporals, points) — Phase 4
  const set = `${alias}.${property.getKey()}`

  // Only set primary key on create
  if (property.isPrimaryKey()) {
    builder.onCreateSet(set, value)

    return builder
  }

  // On create set
  if (property.getOnCreateSet()) {
    builder.onCreateSet(set, value)
  }

  // On match set
  if (property.getOnMatchSet()) {
    builder.onMatchSet(set, value)
  }

  // Always set
  if (
    (!property.getOnCreateSet() && !property.getOnMatchSet()) ||
    property.getAlwaysSet() ||
    property.isUnique()
  ) {
    builder.set(set, value)
  }

  return builder
}
