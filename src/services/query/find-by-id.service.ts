import { Newable } from '../../meta/newable'
import Builder from '../../query'
import { THIS_NODE } from '../../constants'
import EntitySchema from '../../meta/entity/entity-schema'
import QueryService from './query.service'

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
