import type { Newable } from '../../meta/newable.js'
import Builder from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type EntitySchema from '../../meta/entity/entity-schema.js'
import QueryService from './query.service.js'

export default class FindService extends QueryService {
  async find(
    constructor: Newable,
    schema: EntitySchema,
    value: unknown,
  ): Promise<unknown | undefined> {
    const builder = new Builder()

    const primaryKey = schema.getPrimaryKey()!.getKey()

    builder.match(THIS_NODE, schema.getLabels(), { [primaryKey]: value })

    return this.returnFirst(constructor, schema, builder)
  }
}
