import type { Newable } from '../../meta/newable.js'
import { Builder } from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type { GraphNode, QueryParams as QueryParameters } from '../../driver/types.js'
import { hydrate } from '../../hydrate.js'
import { valueToJson } from '../../serialise.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { PropertySchema } from '../../meta/property-schema.js';
import { PropertyType } from '../../meta/property-schema.js'
import QueryService from './query.service.js'
import { type OrderSpec, applyOrder } from './get.service.js'
import { labelPattern } from './bulk.service.js'

/**
Property the cursor keyset defaults to when orderBy is not given
*/
const DEFAULT_CURSOR_PROPERTY = 'createdAt'

/**
Property -> direction pagination (the classic form):
paginate(model, filter, { page, limit, order? })
*/
export interface OffsetPaginateOptions {
  /**
  1-based page number (default 1)
  */
  page?: number

  /**
  Page size
  */
  limit: number

  /**
  Order spec, as accepted by all()/get() — keep it stable across pages
  */
  order?: OrderSpec
}

/**
Keyset/cursor pagination on a temporal (or other comparable) property:
paginate(model, filter, { limit, orderBy?, after?, before? })
*/
export interface CursorPaginateOptions {
  /**
  Page size
  */
  limit: number

  /**
  Property to keyset on (default 'createdAt')
  */
  orderBy?: string

  /**
  Cursor of the previous page's last item: walk forward in time
  */
  after?: string | number

  /**
  Cursor of the previous page's first item: walk backward in time
  */
  before?: string | number
}

export type PaginateOptions = OffsetPaginateOptions | CursorPaginateOptions

/**
Offset/page result
*/
export interface Page<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
Cursor/keyset result — items are returned ascending either way
*/
export interface CursorPage<T> {
  items: T[]

  /**
  Cursor of the NEXT page in the walk direction (pass it back as
  `after` or `before`); undefined when the walk is exhausted.

  Opaque: a composite of the boundary property value and the boundary
  node's elementId, so rows sharing a property value (bulk writes land
  in the same millisecond) are never skipped between pages. Plain
  scalar values stay accepted as cursors.
  */
  nextCursor: string | number | undefined

  hasMore: boolean
}

/**
The Cypher cast that turns a plain param into the property's temporal type
*/
export function temporalCastFn(type: PropertyType): string | undefined {
  switch (type) {
    case PropertyType.DATE: {
      return 'date'
    }

    case PropertyType.TIME: {
      return 'time'
    }

    case PropertyType.DATETIME: {
      return 'datetime'
    }

    case PropertyType.LOCALTIME: {
      return 'localtime'
    }

    case PropertyType.LOCALDATETIME: {
      return 'localdatetime'
    }

    default: {
      return undefined
    }
  }
}

/**
A stored property value as a portable cursor: temporal values become ISO
strings (driver instances via toString(), the Relate engine's plain
objects via the shared serialisation — engine temporal objects are not
portable params, so cursors travel as plain values cast in Cypher)
*/
export function toCursorValue(
  value: unknown,
  property: PropertySchema,
): string | number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const json = valueToJson(value, property)

  if (typeof json === 'string' || typeof json === 'number') {
    return json
  }

  // Counts and large integers can surface as bigint
  if (typeof json === 'bigint') {
    return Number(json)
  }

  return undefined
}

function requireLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`limit must be a positive integer, received ${limit}`)
  }

  return limit
}

/**
Property-equality filter, the same semantics as get()/all()
*/
function applyFilter(
  builder: Builder,
  schema: EntitySchema,
  filter: Record<string, unknown>,
): void {
  for (const property of schema.getProperties()) {
    const key = property.getKey()

    if (Object.hasOwn(filter, key)) {
      builder.where(`${THIS_NODE}.${key}`, filter[key])
    }
  }
}

/**
Pagination helpers.

Two modes, selected by the options shape:
 - `{ page, limit, order? }` — offset pagination over two autocommit
   reads (data + COUNT), returning { items, total, page, limit, totalPages }
 - `{ limit, orderBy?, after?/before? }` — keyset pagination on a
   temporal property (`WHERE this.createdAt > datetime($cursor)`),
   returning { items, nextCursor, hasMore }
*/
export default class PaginateService extends QueryService {
  async paginate<T>(
    constructor: Newable,
    schema: EntitySchema,
    filter: Record<string, unknown> = {},
    options: PaginateOptions,
  ): Promise<Page<T> | CursorPage<T>> {
    const limit = requireLimit((options as { limit?: unknown }).limit)

    if ('page' in options) {
      if ('after' in options || 'before' in options) {
        throw new Error('paginate accepts either page or after/before, not both')
      }

      return this.offsetPage<T>(constructor, schema, filter, options, limit)
    }

    return this.cursorPage<T>(constructor, schema, filter, options, limit)
  }

  /**
  Data query + COUNT query, two autocommit reads
  */
  private async offsetPage<T>(
    constructor: Newable,
    schema: EntitySchema,
    filter: Record<string, unknown>,
    options: OffsetPaginateOptions,
    limit: number,
  ): Promise<Page<T>> {
    const page = options.page ?? 1

    if (!Number.isInteger(page) || page < 1) {
      throw new Error(`page must be a positive integer, received ${page}`)
    }

    // Data query — hydrated through the shared eager-aware return path
    const data = new Builder()

    data.match(THIS_NODE, schema.getLabels())
    applyFilter(data, schema, filter)
    applyOrder(data, options.order)

    const items = await this.return<T>(constructor, schema, data, (page - 1) * limit, limit)

    // Count query — a second autocommit read
    const count = new Builder()

    count.match(THIS_NODE, schema.getLabels())
    applyFilter(count, schema, filter)
    count.return(`count(${THIS_NODE}) AS total`)

    const built = count.build()
    const output = await this.runner.run(built.query, built.params)

    const total = Number(output.records[0]?.get('total') ?? 0)

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
  Keyset page: LIMIT limit+1 answers hasMore; the statement is written
  by hand because the builder cannot wrap a parameter in the temporal
  cast (src/query is upstream of this service)
  */
  private async cursorPage<T>(
    constructor: Newable,
    schema: EntitySchema,
    filter: Record<string, unknown>,
    options: CursorPaginateOptions,
    limit: number,
  ): Promise<CursorPage<T>> {
    if (options.after !== undefined && options.before !== undefined) {
      throw new Error('paginate accepts either after or before, not both')
    }

    const key = options.orderBy ?? DEFAULT_CURSOR_PROPERTY

    const property = schema.getProperties().find((candidate) => candidate.getKey() === key)

    if (!property) {
      throw new Error(
        `Unknown cursor property "${key}" on ${schema.getLabels().join(':') || 'entity'}`,
      )
    }

    const cast = temporalCastFn(property.getType())

    // Forward walks after a cursor; backward walks before one. Items
    // come back ascending either way
    const isForward = options.before === undefined
    const cursor = isForward ? options.after : options.before

    const parameters: QueryParameters = {}
    const conds: string[] = []

    for (const candidate of schema.getProperties()) {
      const filterKey = candidate.getKey()

      if (Object.hasOwn(filter, filterKey)) {
        const parameter = `filter_${filterKey.replaceAll(/[^a-z0-9]+/gi, '_')}`

        parameters[parameter] = filter[filterKey]
        conds.push(`${THIS_NODE}.${filterKey} = $${parameter}`)
      }
    }

    if (cursor !== undefined) {
      // Composite cursors tie-break on elementId, so keyset pages never
      // skip rows sharing the boundary value; scalar cursors (and raw
      // property values) compare on the property alone
      const { value, id } = parseCursor(cursor)

      const comparison = isForward ? '>' : '<'
      const casted = cast ? `${cast}($cursor)` : '$cursor'

      parameters['cursor'] = value

      conds.push(
        id === undefined
          ? `${THIS_NODE}.${key} ${comparison} ${casted}`
          : `(${THIS_NODE}.${key} ${comparison} ${casted} OR (${THIS_NODE}.${key} = ${casted} AND elementId(${THIS_NODE}) ${comparison} $cursorId))`,
      )

      if (id !== undefined) {
        parameters['cursorId'] = id
      }
    }

    // A total order (property, elementId) — equal property values keep a
    // stable walk order
    const query = [
      `MATCH (${THIS_NODE}${labelPattern(schema.getLabels())})`,
      conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '',
      `ORDER BY ${THIS_NODE}.${key} ${isForward ? 'ASC' : 'DESC'}, elementId(${THIS_NODE}) ${isForward ? 'ASC' : 'DESC'}`,
      // One row over the page size answers hasMore
      `LIMIT ${limit + 1}`,
      `RETURN ${THIS_NODE}`,
    ]
      .filter((line) => line.length)
      .join('\n')

    const output = await this.runner.run(query, parameters)

    const hasMore = output.records.length > limit

    const pageRecords = hasMore ? output.records.slice(0, limit) : output.records

    // Backward walks fetch descending; items are returned ascending
    const ordered = isForward ? pageRecords : [...pageRecords].reverse()

    const items = hydrate<T>(
      constructor as new (
        ...arguments_: never[]
      ) => T,
      { records: ordered },
      THIS_NODE,
    )

    // The boundary item of the walk: forward, the newest row fetched;
    // backward, the oldest (the first row of the ascending items)
    const boundary = ordered[isForward ? ordered.length - 1 : 0]
    const boundaryNode = boundary?.get(THIS_NODE) as GraphNode | undefined
    const boundaryValue = boundaryNode
      ? toCursorValue(boundaryNode.properties[key], property)
      : undefined

    const nextCursor =
      hasMore && boundaryNode && boundaryValue !== undefined
        ? JSON.stringify([boundaryValue, boundaryNode.elementId])
        : undefined

    return { items, nextCursor, hasMore }
  }
}

/**
Split a cursor into its compared value and tie-break elementId: a
composite cursor is the JSON array `[value, elementId]`; anything else is
the scalar value itself (raw property values stay accepted).
*/
function parseCursor(cursor: string | number): { value: string | number; id?: string } {
  if (typeof cursor === 'string' && cursor.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(cursor)

      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        (typeof parsed[0] === 'string' || typeof parsed[0] === 'number') &&
        typeof parsed[1] === 'string'
      ) {
        return { value: parsed[0], id: parsed[1] }
      }
    } catch {
      // Not a composite cursor — fall through and compare as a scalar
    }
  }

  return { value: cursor }
}
