import neo4j from 'neo4j-driver'
import type PropertySchema from './meta/property-schema.js'
import { PropertyType } from './meta/property-schema.js'

/**
Spatial Reference System Identifiers used by Neo4j for point properties

@see https://neo4j.com/docs/cypher/current/syntax/spatial/
*/
const SRID = {
  CARTESIAN_2D: 7203,
  CARTESIAN_3D: 9157,
  WGS_84_2D: 4326,
  WGS_84_3D: 4979,
} as const

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

function isDriverValue(value: unknown): boolean {
  return (
    neo4j.isDate(value) ||
    neo4j.isDateTime(value) ||
    neo4j.isDuration(value) ||
    neo4j.isInt(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isPoint(value) ||
    neo4j.isTime(value)
  )
}

/**
Convert a value into a Neo4j temporal value. Strings are parsed by the
driver (exact, timezone-safe), numbers are treated as epoch milliseconds
and JavaScript Dates are converted with the driver's fromStandardDate().
Any other value is returned unchanged.
*/
function convertTemporal(
  value: unknown,
  fromString: (value: string) => unknown,
  fromStandardDate: (date: Date) => unknown,
): unknown {
  if (typeof value === 'string') {
    return fromString(value)
  }

  if (typeof value === 'number') {
    return fromStandardDate(new Date(value))
  }

  if (value instanceof Date) {
    return fromStandardDate(value)
  }

  return value
}

function convertPoint(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(
      `Cannot convert ${describeValue(value)} to a neo4j Point: expected an object`,
    )
  }

  const { x, y, z, latitude, longitude, height } = value as Record<string, unknown>

  // Cartesian coordinates
  if (isNumber(x)) {
    if (!isNumber(y)) {
      throw new TypeError(
        'Cannot convert object to a neo4j Point: expected a numeric "y" to accompany "x"',
      )
    }

    return isNumber(z)
      ? new neo4j.Point(SRID.CARTESIAN_3D, x, y, z)
      : new neo4j.Point(SRID.CARTESIAN_2D, x, y)
  }

  // WGS 84 (geographic) coordinates: Neo4j stores longitude as x, latitude as y
  if (isNumber(latitude) || isNumber(longitude)) {
    if (!isNumber(latitude) || !isNumber(longitude)) {
      throw new TypeError(
        'Cannot convert object to a neo4j Point: expected numeric "latitude" and "longitude"',
      )
    }

    return isNumber(height)
      ? new neo4j.Point(SRID.WGS_84_3D, longitude, latitude, height)
      : new neo4j.Point(SRID.WGS_84_2D, longitude, latitude)
  }

  throw new TypeError(
    'Cannot convert object to a neo4j Point: expected { x, y[, z] } or { latitude, longitude[, height] }',
  )
}

function convertDuration(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(
      `Cannot convert ${describeValue(value)} to a neo4j Duration: expected an object`,
    )
  }

  const { months, days, seconds, nanoseconds } = value as Record<string, unknown>

  if (!isNumber(months) || !isNumber(days) || !isNumber(seconds) || !isNumber(nanoseconds)) {
    throw new TypeError(
      'Cannot convert object to a neo4j Duration: expected numeric { months, days, seconds, nanoseconds }',
    )
  }

  return new neo4j.Duration(months, days, seconds, nanoseconds)
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value)
  }

  return NaN
}

function convertInteger(value: unknown): number {
  const parsed = parseNumber(value)

  if (!Number.isInteger(parsed)) {
    throw new TypeError(`Expected an integer, received ${describeValue(value)}`)
  }

  return parsed
}

function convertFloat(value: unknown): number {
  const parsed = parseNumber(value)

  if (Number.isNaN(parsed)) {
    throw new TypeError(`Expected a number, received ${describeValue(value)}`)
  }

  return parsed
}

function convertSingleValue(value: unknown, type: PropertyType): unknown {
  // Nullish values indicate an un-set property; unsetting is handled upstream
  if (value === null || value === undefined) {
    return value
  }

  // Values that are already Neo4j driver instances pass through untouched
  if (isDriverValue(value)) {
    return value
  }

  switch (type) {
    case PropertyType.DATE: {
      return convertTemporal(
        value,
        (string_) => neo4j.Date.fromString(string_),
        (date) => neo4j.Date.fromStandardDate(date),
      )
    }

    case PropertyType.TIME: {
      return convertTemporal(
        value,
        (string_) => neo4j.Time.fromString(string_),
        (date) => neo4j.Time.fromStandardDate(date),
      )
    }

    case PropertyType.DATETIME: {
      return convertTemporal(
        value,
        (string_) => neo4j.DateTime.fromString(string_),
        (date) => neo4j.DateTime.fromStandardDate(date),
      )
    }

    case PropertyType.LOCALTIME: {
      return convertTemporal(
        value,
        (string_) => neo4j.LocalTime.fromString(string_),
        (date) => neo4j.LocalTime.fromStandardDate(date),
      )
    }

    case PropertyType.LOCALDATETIME: {
      return convertTemporal(
        value,
        (string_) => neo4j.LocalDateTime.fromString(string_),
        (date) => neo4j.LocalDateTime.fromStandardDate(date),
      )
    }

    case PropertyType.POINT: {
      return convertPoint(value)
    }

    case PropertyType.DURATION: {
      return convertDuration(value)
    }

    case PropertyType.INTEGER: {
      return convertInteger(value)
    }

    case PropertyType.FLOAT:
    case PropertyType.NUMBER: {
      return convertFloat(value)
    }

    default: {
      return value
    }
  }
}

/**
Convert a JavaScript value into the matching Neo4j driver value for the
given property. Temporal strings and dates become driver temporal values,
points and durations are built from plain objects and numbers are validated
and passed through as plain numbers (the driver's Integer type is not used).

Arrays are converted element-by-element when the property is an array, and
values that need no conversion (strings, booleans, driver values, etc) are
returned unchanged.
*/
export function convertPropertyValue(value: unknown, property: PropertySchema): unknown {
  return property.isArray() && Array.isArray(value)
    ? value.map((element) => convertSingleValue(element, property.getType()))
    : convertSingleValue(value, property.getType())
}
