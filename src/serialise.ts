import neo4j from 'neo4j-driver'
import { getModel } from './meta'
import { Newable } from './meta/newable'
import PropertySchema, { PropertyType } from './meta/property-schema'

/**
 * Property types that carry graph structure rather than user data: they are
 * skipped by toJson() (internal ids surface through the `_id` field instead).
 */
const NON_OUTPUT_TYPES = [
  PropertyType.INTERNAL_ID,
  PropertyType.ALL_PROPERTIES,
  PropertyType.NODE,
  PropertyType.RELATIONSHIP,
  PropertyType.ONE_TO_ONE,
  PropertyType.ONE_TO_MANY,
  PropertyType.START_NODE,
  PropertyType.END_NODE,
  PropertyType.OTHER_NODE,
]

const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => key in value)
}

function dateToString(value: Record<string, unknown>): string {
  return `${pad(value.year as number, 4)}-${pad(value.month as number)}-${pad(value.day as number)}`
}

function offsetToString(offsetSeconds: unknown): string {
  if (typeof offsetSeconds !== 'number' || Number.isNaN(offsetSeconds)) {
    return ''
  }

  if (offsetSeconds === 0) {
    return 'Z'
  }

  const sign = offsetSeconds < 0 ? '-' : '+'
  const abs = Math.abs(offsetSeconds)

  return `${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}`
}

function timeToString(value: Record<string, unknown>): string {
  const base = `${pad(value.hour as number)}:${pad(value.minute as number)}:${pad(value.second as number)}`
  const nanoseconds = (value.nanosecond as number) || 0

  return nanoseconds ? `${base}.${pad(nanoseconds, 9)}` : base
}

function durationToString(value: Record<string, unknown>): string {
  const seconds = (value.seconds as number) || 0
  const nanos = (value.nanos as number) ?? (value.nanoseconds as number) ?? 0
  const fraction = nanos ? `.${pad(nanos, 9)}` : ''

  return `P${value.months ?? 0}M${value.days ?? 0}DT${seconds}${fraction}S`
}

function pointToJson(value: Record<string, unknown>): Record<string, unknown> {
  const { srid, x, y, z } = value

  return z === undefined || z === null ? { srid, x, y } : { srid, x, y, z }
}

/**
 * Convert a Neo4j driver instance into its JSON friendly shape.
 * Temporal types share an ISO string via toString(); points become plain
 * coordinate objects. Returns undefined for non-driver values.
 */
function driverValueToJson(value: unknown): unknown {
  if (neo4j.isInt(value)) {
    return value.toNumber()
  }

  if (
    neo4j.isDate(value) ||
    neo4j.isDateTime(value) ||
    neo4j.isTime(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isDuration(value)
  ) {
    return value.toString()
  }

  if (neo4j.isPoint(value)) {
    return pointToJson(value as unknown as Record<string, unknown>)
  }

  return undefined
}

/**
 * Convert a plain object (as hydrated by the embedded Relate engine) into
 * its JSON friendly shape, keyed by the property's declared type. Returns
 * undefined when the value doesn't match the expected shape.
 */
function plainObjectToJson(value: Record<string, unknown>, type: PropertyType): unknown {
  switch (type) {
    case PropertyType.DATE:
      if (hasKeys(value, ['year', 'month', 'day'])) {
        return dateToString(value)
      }
      break

    case PropertyType.TIME:
      if (hasKeys(value, ['hour', 'minute', 'second'])) {
        return timeToString(value) + offsetToString(value.offsetSeconds)
      }
      break

    case PropertyType.LOCALTIME:
      if (hasKeys(value, ['hour', 'minute', 'second'])) {
        return timeToString(value)
      }
      break

    case PropertyType.DATETIME:
      if (hasKeys(value, ['year', 'month', 'day', 'hour', 'minute', 'second'])) {
        const zone = typeof value.zone === 'string' ? `[${value.zone}]` : ''

        return (
          dateToString(value) +
          'T' +
          timeToString(value) +
          offsetToString(value.offsetSeconds) +
          zone
        )
      }
      break

    case PropertyType.LOCALDATETIME:
      if (hasKeys(value, ['year', 'month', 'day', 'hour', 'minute', 'second'])) {
        return dateToString(value) + 'T' + timeToString(value)
      }
      break

    case PropertyType.DURATION:
      if (hasKeys(value, ['months', 'days', 'seconds'])) {
        return durationToString(value)
      }
      break

    case PropertyType.POINT:
      if (hasKeys(value, ['srid', 'x', 'y'])) {
        return pointToJson(value)
      }
      break

    default:
      break
  }

  return undefined
}

function isEntity(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    getModel((value as { constructor?: unknown }).constructor as Newable) !== undefined
  )
}

function toOutputValue(value: unknown, property: PropertySchema): unknown {
  // Nested entities (eagerly loaded relationships, arrays of entities)
  if (Array.isArray(value)) {
    return value.map((item) => toOutputValue(item, property))
  }

  if (isEntity(value)) {
    return toJson(value)
  }

  return valueToJson(value, property)
}

/**
 * Convert a single property value into its JSON friendly shape.
 */
export function valueToJson(value: unknown, property: PropertySchema): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // Neo4j driver instances (neo4j backend): ISO strings / plain coordinates
  const driver = driverValueToJson(value)

  if (driver !== undefined) {
    return driver
  }

  if (typeof value === 'object') {
    const plain = plainObjectToJson(value as Record<string, unknown>, property.getType())

    if (plain !== undefined) {
      return plain
    }
  }

  return value
}

/**
 * Convert an entity into a JSON friendly object: plain properties (hidden and
 * structural properties skipped), `_id` (elementId when the model carries an
 * internal id property) and `_labels` (the schema's labels). Eagerly loaded
 * relationships are serialised recursively.
 */
export function toJson(entity: unknown): Record<string, unknown> {
  const instance = entity as Record<string, unknown> | null
  const schema = instance ? getModel(instance.constructor as Newable) : undefined

  if (!schema || !instance) {
    const name = instance?.constructor?.name ?? String(entity)

    throw new Error(`Cannot serialise "${name}": no model is registered for it`)
  }

  const properties = schema.getProperties()
  const internalId = properties.find((property) => property.getType() === PropertyType.INTERNAL_ID)

  const output: Record<string, unknown> = {
    _id: internalId ? (instance[internalId.getKey()] ?? null) : null,
    _labels: schema.getLabels(),
  }

  properties.forEach((property) => {
    const key = property.getKey()

    if (property.isHidden() || NON_OUTPUT_TYPES.includes(property.getType())) {
      return
    }

    const value = instance[key]

    // Un-set properties are omitted (parity with neode's properties map)
    if (value === undefined) {
      return
    }

    output[key] = toOutputValue(value, property)
  })

  // Eagerly loaded relationships: single entities or arrays of entities
  schema.getRelationships().forEach((relationship) => {
    const key = relationship.getKey()

    if (!Object.hasOwn(instance, key)) {
      return
    }

    const value = instance[key]

    if (value === undefined || value === null) {
      return
    }

    output[key] = Array.isArray(value) ? value.map((item) => toJson(item)) : toJson(value)
  })

  return output
}
