import { Builder,  Direction  } from '../query/index.js'
import { THIS_NODE } from '../constants.js'
import type { Runner } from '../driver/types.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { Newable } from '../meta/newable.js'
import type { PropertySchema } from '../meta/property-schema.js';
import { PropertyType } from '../meta/property-schema.js'
import type { OrderSpec } from '../services/query/get.service.js'
import { projectionNode } from './projection.js'
import { hydrateProjection } from './hydrate.js'

/**
True for the related-projection kinds that support nested filters / sort
*/
function isRelatedProjection(property: PropertySchema): boolean {
  return (
    property.getType() === PropertyType.RELATED_ONE ||
    property.getType() === PropertyType.RELATED_MANY
  )
}

/**
A nested filter value: a plain map of related-property filters
*/
function isFilterMap(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  // Plain maps only — Date, driver temporals etc. stay own-property values
  return prototype === Object.prototype || prototype === null
}

/**
Cypher variable bound to the related node of a nested filter / sort
*/
function filterAlias(key: string): string {
  return `${THIS_NODE}_${key}_filter`
}

/**
Bind the single-hop traversal for a nested filter / sort on a related
property: `(this)-[:TYPE]->(alias:TargetLabels)`. An inner MATCH filters
the read; an OPTIONAL MATCH only binds the alias so a nested sort never
drops rows.
*/
function bindTraversal(
  builder: Builder,
  property: PropertySchema,
  alias: string,
  optional: boolean,
): void {
  const types = (property.getRelationshipType() ?? property.getKey())
    .split('|')
    .filter((part) => part.length)

  const direction = property.getDirection() ?? Direction.OUTGOING

  const target = property.getEntity()
  const labels = target ? (getModel(target)?.getLabels() ?? false) : false

  if (optional) {
    builder.optionalMatch(THIS_NODE)
  } else {
    builder.match(THIS_NODE)
  }

  builder.relationship(types, direction, `${alias}_rel`).to(alias, labels)
}

/**
The property map: own properties filter as property equality (GetService
parity, unknown keys ignored); object values on @RelatedOne / @RelatedMany
keys filter on the related node's properties via a bound traversal, and an
object value on any other property kind is a clear error. Returns the
traversal aliases bound per property key, for nested sort reuse.
*/
function applyFilters(
  builder: Builder,
  schema: EntitySchema,
  parameters: Record<string, unknown>,
): Map<string, string> {
  const bound = new Map<string, string>()

  for (const property of schema.getProperties()) {
    const key = property.getKey()

    if (!Object.hasOwn(parameters, key)) {
      continue
    }

    const value = parameters[key]

    if (!isFilterMap(value)) {
      builder.where(`${THIS_NODE}.${key}`, value)

      continue
    }

    if (!isRelatedProjection(property)) {
      throw new Error(
        `Cannot apply a nested filter on '${key}': only @RelatedOne and @RelatedMany properties support nested filters`,
      )
    }

    const alias = filterAlias(key)

    // shortcut: a @RelatedOne with several matching relationships yields
    // duplicate rows (the projection takes [0], the filter MATCH does not
    // dedupe) — upgrade to an EXISTS { } wrap if singular graphs stop holding
    bindTraversal(builder, property, alias, false)

    for (const [field, fieldValue] of Object.entries(value)) {builder.where(`${alias}.${field}`, fieldValue)}
    

    bound.set(key, alias)
  }

  return bound
}

/**
Ordering with nested sort support (NTS-145): a map key naming a
@RelatedOne orders by the related node's property — `{ course: 'slug' }`
ORDER BYs the traversal alias, bound with an OPTIONAL MATCH when no nested
filter already bound it. Every other form behaves exactly like the plain
applyOrder.
*/
function applyOrder(
  builder: Builder,
  order: OrderSpec | undefined,
  schema: EntitySchema,
  bound: Map<string, string>,
): void {
  if (!order) {
    return
  }

  if (typeof order === 'string') {
    builder.orderBy(`${THIS_NODE}.${order}`)
  } else if (Array.isArray(order)) {
    for (const entry of order) {applyOrder(builder, entry, schema, bound)}
  } else if ('field' in order && typeof order.field === 'string') {
    builder.orderBy({ field: `${THIS_NODE}.${order.field}`, order: order.order })
  } else {
    for (const [key, field] of Object.entries(order as Record<string, string>)) {
      const property = schema.hasProperty(key) ? schema.getProperty(key) : undefined

      if (!property || !isRelatedProjection(property)) {
        builder.orderBy(`${THIS_NODE}.${key}`, field)

        continue
      }

      if (property.getType() === PropertyType.RELATED_MANY) {
        throw new Error(
          `Cannot sort by a nested property of '${key}': @RelatedMany has no single related node to order by`,
        )
      }

      const alias = bound.get(key)

      if (alias) {
        builder.orderBy(`${alias}.${field}`)

        continue
      }

      const sortAlias = filterAlias(key)

      bindTraversal(builder, property, sortAlias, true)
      bound.set(key, sortAlias)

      builder.orderBy(`${sortAlias}.${field}`)
    }
  }
}

/**
Read service for models with projected properties (NTS-135/136/137/138):
the same match / where surface as the plain query services, but the
RETURN map projection carries every projected value — related subsets,
counts, exists, label predicates, expressions — in one query per read.

NTS-145: object values on @RelatedOne / @RelatedMany filter keys traverse
to the related node and filter on its properties (`{ course: { slug: 'x' } }`);
a nested sort key (`{ course: 'slug' }`) ORDER BYs the bound traversal alias.
*/
export default class ProjectionService {
  private readonly runner: Runner

  constructor(runner: Runner) {
    this.runner = runner
  }

  /**
  All nodes matching the given property map (GetService parity)
  */
  async get<T>(
    constructor: Newable,
    schema: EntitySchema,
    parameters: Record<string, unknown> = {},
    limit?: number,
    skip?: number,
    order?: OrderSpec,
  ): Promise<T[]> {
    const builder = new Builder()

    builder.match(THIS_NODE, schema.getLabels())

    const bound = applyFilters(builder, schema, parameters)

    applyOrder(builder, order, schema, bound)

    return this.run<T>(constructor, schema, builder, limit, skip)
  }

  /**
  One node by primary key value (FindService parity)
  */
  async find<T>(
    constructor: Newable,
    schema: EntitySchema,
    value: unknown,
  ): Promise<T | undefined> {
    const builder = new Builder()

    const primaryKey = schema.getPrimaryKey()!.getKey()

    builder.match(THIS_NODE, schema.getLabels(), { [primaryKey]: value })

    return (await this.run<T>(constructor, schema, builder, 1))[0]
  }

  /**
  One node by element ID (FindByIdService parity)
  */
  async findById<T>(
    constructor: Newable,
    schema: EntitySchema,
    elementId: string,
  ): Promise<T | undefined> {
    const builder = new Builder()

    builder.match(THIS_NODE).whereId(THIS_NODE, elementId)

    return (await this.run<T>(constructor, schema, builder, 1))[0]
  }

  private async run<T>(
    constructor: Newable,
    schema: EntitySchema,
    builder: Builder,
    limit?: number,
    skip?: number,
  ): Promise<T[]> {
    builder.return(`${projectionNode(THIS_NODE, schema)} AS ${THIS_NODE}`)

    if (skip) {builder.skip(skip)}
    if (limit) {builder.limit(limit)}

    const { query, params } = builder.build()

    const res = await this.runner.run(query, params)

    return res.records.map((row) =>
      hydrateProjection<T>(schema, constructor, row.get(THIS_NODE) as Record<string, unknown>),
    )
  }
}
