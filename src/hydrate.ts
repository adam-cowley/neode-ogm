import type { GraphNode, GraphRelationship, QueryOutput, QueryRecord } from './driver/types.js'
import { ELEMENT_ID } from './constants.js'
import { getModel } from './meta/index.js'
import EntitySchema, { EntityType } from './meta/entity/entity-schema.js'
import type PropertySchema from './meta/property-schema.js'
import { PropertyType, isProjectedProperty } from './meta/property-schema.js'
import type RelationshipPropertySchema from './meta/relationship-property-schema.js'
import { EAGER_ID, EAGER_LABELS, EAGER_TYPE } from './query/eager-utils.js'
import { Direction } from './query/index.js'
import { applyEntityMethods } from './entity-methods.js'
import type { WithMethods } from './entity-methods.js'
import type { Newable } from './meta/newable.js'
import Collection from './collection.js'

export { hydrateProjection } from './projection/index.js'

const DEFAULT_ALIAS = 'this'

export interface EagerNode {
  node: GraphNode
  eager?: Record<string, EagerRelationship[]>
}

export interface EagerRelationship {
  rel: GraphRelationship
  start: EagerNode
  end: EagerNode
  other: EagerNode
}

/**
An eager projection map, as produced by the eagerNode/eagerPattern Cypher
builders: node or relationship properties inline, plus the __EAGER_ID__
(and __EAGER_LABELS__ / __EAGER_TYPE__) markers, plus one key per eager
relationship holding the nested projection value(s).
*/
export type EagerProjectionMap = Record<string, unknown>

/**
Eager projections are plain maps carrying the __EAGER_ID__ marker;
driver node values never do.
*/
function isEagerProjectionMap(value: unknown): value is EagerProjectionMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && EAGER_ID in value
}

/**
Read-side property hydration (NTS-139): a stored/projected `null` hydrates
as `undefined` — a Neo4j property is either present or absent, null never
persists, so `undefined` is the honest shape for "not set" (graphacademy's
`?? undefined` convention). A `coalesce` config then supplies fallbacks:
a literal, or sibling property names whose first non-null value wins.
*/
function hydrateScalarProperty(property: PropertySchema, values: Record<string, unknown>): unknown {
  const value = values[property.getKey()]

  if (value !== null && value !== undefined) {
    return value
  }

  const coalesce = property.getCoalesce()

  if (coalesce === undefined) {
    return undefined
  }

  if (typeof coalesce === 'string') {
    return coalesce
  }

  for (const key of coalesce) {
    const fallback = values[key]

    if (fallback !== null && fallback !== undefined) {
      return fallback
    }
  }

  return undefined
}

export function hydrateNode<T>(
  targetSchema: EntitySchema,
  targetEntity: Newable,
  node: GraphNode | EagerProjectionMap,
  eager: Record<string, EagerRelationship[]> = {},
): T {
  // Wire the active-record instance methods onto the class prototype
  // (idempotent) so hydrated instances can save/update/delete themselves
  applyEntityMethods(targetEntity)

  const entity = new (targetEntity as any)() as Record<string, unknown>

  // A projection map carries its properties inline with the markers and
  // the eager relationship keys; a driver node keeps the plain shapes
  const isProjection = isEagerProjectionMap(node)

  let elementId: string | undefined
  let properties: Record<string, unknown>
  let eagerValues: Record<string, unknown>

  if (isProjection) {
    elementId = node[EAGER_ID] as string | undefined

    // Everything except the reserved markers and the eager relationship
    // keys is a node property
    const reserved = new Set<string>([EAGER_ID, EAGER_LABELS, EAGER_TYPE])
    for (const rel of targetSchema.getRelationships()) {
      reserved.add(rel.getKey())
    }

    properties = Object.fromEntries(Object.entries(node).filter(([key]) => !reserved.has(key)))

    eagerValues = node
  } else {
    elementId = node.elementId
    properties = node.properties
    eagerValues = eager
  }

  // Stash the elementId so matching works without the deprecated
  // @InternalId property (non-enumerable: not data — must not leak into
  // serialisation or structural copies)
  if (elementId) {
    Object.defineProperty(entity, ELEMENT_ID, { value: elementId })
  }

  for (const property of targetSchema.getProperties()) {
    switch (property.getType()) {
      case PropertyType.INTERNAL_ID: {
        entity[property.getKey()] = elementId
        break
      }

      case PropertyType.ALL_PROPERTIES: {
        entity[property.getKey()] = properties
        break
      }

      case PropertyType.NODE: {
        entity[property.getKey()] = node
        break
      }

      default: {
        // Projected read-model values keep their raw shape — the
        // projection layer post-processes them and a related-one
        // miss stays null; stored scalars get hydration defaults
        entity[property.getKey()] = isProjectedProperty(property)
          ? properties[property.getKey()]
          : hydrateScalarProperty(property, properties)
        break
      }
    }
  }

  // Hydrate Eager Relationships
  for (const rel of targetSchema.getRelationships()) {
    const key = rel.getKey()

    if (!Object.hasOwn(eagerValues, key) || !eagerValues[key]) {
      continue
    }

    const value = eagerValues[key]

    // Check type - is this a node entity or a relationship entity?
    const targetEntity = rel.getTarget()
    const targetSchema = getModel(targetEntity)

    const values = (Array.isArray(value) ? value : [value]) as unknown[]
    const hydrated = values.map((item) =>
      targetSchema.getType() === EntityType.RelationshipEntity
        ? hydrateRelationship(
            targetSchema,
            targetEntity,
            item as EagerRelationship | EagerProjectionMap,
            rel,
            entity,
          )
        : hydrateEagerTargetNode(targetSchema, targetEntity, item),
    )

    if (rel.getMany()) {
      entity[key] = hydrated
    } else if (hydrated.length > 0) {
      entity[key] = hydrated[0]
    }
  }

  return entity as unknown as T
}

/**
Hydrate one eager value for a node-entity target. Projection maps hydrate
recursively; the legacy hand-built shape ({rel, start, end, other}) hydrates
from its `other` node.
*/
function hydrateEagerTargetNode(
  targetSchema: EntitySchema,
  targetEntity: Newable,
  item: unknown,
): unknown {
  if (isEagerProjectionMap(item)) {
    return hydrateNode(targetSchema, targetEntity, item)
  }

  const legacy = item as EagerRelationship

  return hydrateNode(targetSchema, targetEntity, legacy.other.node, legacy.other.eager || {})
}

export function hydrateRelationship<T>(
  targetSchema: EntitySchema,
  targetEntity: Newable,
  relObject: EagerRelationship | EagerProjectionMap,
  rel?: RelationshipPropertySchema,
  parent?: unknown,
): T {
  // Wire the active-record instance methods onto the class prototype
  // (idempotent) so hydrated instances can save/update/delete themselves
  applyEntityMethods(targetEntity)

  const entity = new (targetEntity as any)() as Record<string, unknown>

  // Eager projection shape: relationship properties inline with the
  // __EAGER_ID__ / __EAGER_TYPE__ markers, and the node at the far end
  // of the relationship projected under the parent relationship's key
  if (isEagerProjectionMap(relObject)) {
    const record = relObject
    const direction = rel!.getDirection()
    const relKey = rel!.getKey()
    const farRecord = record[relKey] as EagerProjectionMap | undefined

    const properties = Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => key !== EAGER_ID && key !== EAGER_TYPE && key !== relKey,
      ),
    )

    for (const property of targetSchema.getProperties()) {
      const key = property.getKey()

      switch (property.getType()) {
        case PropertyType.INTERNAL_ID: {
          entity[key] = record[EAGER_ID]
          break
        }

        case PropertyType.RELATIONSHIP: {
          // A projection carries no driver relationship object;
          // the raw map is the closest equivalent
          entity[key] = record
          break
        }

        case PropertyType.START_NODE:
        case PropertyType.END_NODE:
        case PropertyType.OTHER_NODE: {
          // The node at the far end of the pattern is the one
          // projected in the map; the near node is the entity
          // this relationship hangs off
          const isIncoming = direction === Direction.INCOMING
          const isFar =
            property.getType() === PropertyType.OTHER_NODE ||
            (property.getType() === PropertyType.START_NODE ? isIncoming : !isIncoming)

          if (!isFar) {
            entity[key] = parent
            break
          }

          if (!farRecord) {
            throw new Error(
              `Cannot hydrate ${property.getType()} property "${key}": missing node in eager data`,
            )
          }

          entity[key] = hydrateNode(getModel(property.getEntity()), property.getEntity(), farRecord)
          break
        }

        default: {
          entity[key] = hydrateScalarProperty(property, properties)
          break
        }
      }
    }

    return entity as unknown as T
  }

  // Legacy hand-built shape: { rel, start, end, other }
  const { rel: graphRel, start, end, other } = relObject

  for (const property of targetSchema.getProperties()) {
    let value: unknown

    switch (property.getType()) {
      case PropertyType.INTERNAL_ID: {
        value = graphRel.elementId
        break
      }

      case PropertyType.RELATIONSHIP: {
        value = graphRel
        break
      }

      case PropertyType.START_NODE:
      case PropertyType.END_NODE:
      case PropertyType.OTHER_NODE: {
        const eagerSchema = getModel(property.getEntity())
        const eagerEntity = property.getEntity()

        let innerNode: GraphNode | undefined
        let innerEager: Record<string, EagerRelationship[]> = {}

        // Work out which node to hydrate
        if (property.getType() === PropertyType.START_NODE) {
          innerNode = start.node
          innerEager = start.eager || {}
        } else if (property.getType() === PropertyType.END_NODE) {
          innerNode = end.node
          innerEager = end.eager || {}
        } else if (property.getType() === PropertyType.OTHER_NODE) {
          innerNode = other.node
          innerEager = other.eager || {}
        }

        if (!innerNode) {
          throw new Error(
            `Cannot hydrate ${property.getType()} property "${property.getKey()}": missing node in eager data`,
          )
        }

        value = hydrateNode(eagerSchema, eagerEntity, innerNode, innerEager)
        break
      }

      default: {
        value = hydrateScalarProperty(property, graphRel.properties)
        break
      }
    }

    entity[property.getKey()] = value
  }

  return entity as unknown as T
}

function requireSchema(constructor: new (...arguments_: never[]) => unknown): EntitySchema {
  const schema = getModel(constructor)

  if (!schema) {
    const name = (constructor as { name?: string }).name || 'unknown'

    throw new Error(`Couldn't find a model for "${name}".`)
  }

  return schema
}

/**
Hydrate a raw query result (as returned by readCypher/writeCypher or
Builder#execute) into typed entities: each record's `alias` column is the
node, any other column feeds eager relationship hydration
(neode's Factory.hydrate)
*/
export function hydrate<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): WithMethods<T>[] {
  const schema = requireSchema(constructor)

  return output.records
    .filter((row) => row.has(alias) && row.get(alias) != null)
    .map(
      (row) =>
        // Hydration wires the active-record methods onto the prototype —
        // the returned instance IS a WithMethods<T>
        hydrateNode<T>(
          schema,
          constructor,
          row.get(alias) as GraphNode,
          eagerColumns(row, alias),
        ) as WithMethods<T>,
    )
}

/**
Extra record columns (every key except the node alias) as the eager values
hydrateNode understands: one legacy eager entry per column, whose node is
the column value
*/
function eagerColumns(row: QueryRecord, alias: string): Record<string, EagerRelationship[]> {
  return Object.fromEntries(
    row.keys
      .filter((key) => key !== alias)
      .map((key) => [key, [{ other: { node: row.get(key) as GraphNode } } as EagerRelationship]]),
  )
}

/**
Hydrate the first record of a raw query result, or undefined when the
result set is empty (neode's Factory.hydrateFirst)
*/
export function hydrateFirst<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): WithMethods<T> | undefined {
  return hydrate<T>(constructor, output, alias)[0]
}

/**
Hydrate a raw query result into a Collection (neode's Factory.hydrate
return shape)
*/
export function toCollection<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): Collection<T> {
  return new Collection(hydrate<T>(constructor, output, alias))
}
