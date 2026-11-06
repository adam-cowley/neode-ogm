import neo4j from 'neo4j-driver'
import type { QueryRecord } from './types.js'

/**
JSON-safe serialisation for raw query values: converts the driver class
instances that survive value normalisation (Integer, temporal types, Point,
Path) and bigints into structures that survive JSON.stringify, recursing
through arrays and plain objects. Everything else passes through unchanged.
*/
export function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // BigInt is not JSON-stringifiable; stringify is lossless for ids
  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (neo4j.isInt(value)) {
    return value.toNumber()
  }

  if (
    neo4j.isDate(value) ||
    neo4j.isDateTime(value) ||
    neo4j.isTime(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isDuration(value)
  ) {
    return value.toString()
  }

  if (neo4j.isPoint(value)) {
    const point = value as unknown as { srid: number; x: number; y: number; z?: number }

    return point.z === undefined || point.z === null
      ? { srid: point.srid, x: point.x, y: point.y }
      : { srid: point.srid, x: point.x, y: point.y, z: point.z }
  }

  if (neo4j.isNode(value)) {
    return {
      elementId: value.elementId,
      labels: value.labels,
      properties: jsonSafe(value.properties),
    }
  }

  if (neo4j.isRelationship(value)) {
    return {
      elementId: value.elementId,
      type: value.type,
      startElementId: value.startNodeElementId,
      endElementId: value.endNodeElementId,
      properties: jsonSafe(value.properties),
    }
  }

  if (neo4j.isPath(value)) {
    const path = value

    return {
      start: jsonSafe(path.start),
      end: jsonSafe(path.end),
      length: path.length,
      segments: path.segments.map((segment) => ({
        start: jsonSafe(segment.start),
        relationship: jsonSafe(segment.relationship),
        end: jsonSafe(segment.end),
      })),
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => jsonSafe(item))
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]),
    )
  }

  return value
}

/**
A QueryRecord whose values are JSON-safe (the rows of `Neode#cypher`).
*/
export function jsonSafeRecord(record: QueryRecord): QueryRecord {
  return {
    get: (key: string) => jsonSafe(record.get(key)),
    has: (key: string) => record.has(key),
    keys: record.keys,
  }
}
