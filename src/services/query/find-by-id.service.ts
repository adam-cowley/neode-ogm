import type { Newable } from '../../meta/newable.js'
import { Builder } from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import QueryService from './query.service.js'

export default class FindByIdService extends QueryService {
  async find(
    constructor: Newable,
    schema: EntitySchema,
    elementId: string,
  ): Promise<unknown | undefined> {
    const builder = new Builder()

    builder.match(THIS_NODE).whereId(THIS_NODE, elementId)

    return this.returnFirst(constructor, schema, builder)
  }
}
