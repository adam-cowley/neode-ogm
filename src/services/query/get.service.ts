import { Newable } from '../../meta/newable'
import Builder from '../../query'
import { THIS_NODE } from '../../constants'
import EntitySchema from '../../meta/entity/entity-schema'
import QueryService from './query.service'

/**
 * Ordering spec, matching neode's all() forms:
 *
 * - `'name'` - order by one property ascending
 * - `['name', 'age']` - order by several properties
 * - `{ name: 'DESC' }` - property -> direction map
 * - `[{ name: 'DESC' }, { age: 'ASC' }]` - list of property -> direction maps
 * - `{ field: 'name', order: 'DESC' }` - two-arg (key, direction) descriptor
 */
export type OrderSpec =
  | string
  | Array<string | Record<string, string>>
  | Record<string, string>
  | { field: string; order?: string }

/**
 * Apply an ordering spec against the builder, prefixing each field with the
 * node alias so callers can use bare property names.
 */
export function applyOrder(builder: Builder, order?: OrderSpec): void {
  if (!order) {
    return
  }

  if (typeof order === 'string') {
    builder.orderBy(`${THIS_NODE}.${order}`)
  } else if (Array.isArray(order)) {
    order.forEach((entry) => applyOrder(builder, entry))
  } else if ('field' in order && typeof order.field === 'string') {
    builder.orderBy({ field: `${THIS_NODE}.${order.field}`, order: order.order })
  } else {
    Object.entries(order as Record<string, string>).forEach(([key, direction]) =>
      builder.orderBy(`${THIS_NODE}.${key}`, direction),
    )
  }
}

export default class GetService extends QueryService {
  async get<T>(
    constructor: Newable,
    schema: EntitySchema,
    params: Record<string, unknown>,
    limit?: number,
    skip?: number,
    order?: OrderSpec,
  ): Promise<T[]> {
    const builder = new Builder()

    builder.match(THIS_NODE, schema.getLabels())

    schema.getProperties().forEach((property) => {
      const key = property.getKey()

      if (Object.hasOwn(params, key)) {
        builder.where(`${THIS_NODE}.${key}`, params[key])
      }
    })

    applyOrder(builder, order)

    return this.return<T>(constructor, schema, builder, skip, limit)
  }
}
