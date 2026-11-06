import type EntitySchema from '../../meta/entity/entity-schema.js'
import { createNodeAndRelationships, modelPropertyValues } from '../write-utils.js'
import { validate } from '../../validation/index.js'
import QueryService from './query.service.js'

export default class CreateService extends QueryService {
  /**
  CREATE a node for the given schema and model, recursively creating and
  relating any nested relationship targets
  */
  async create(schema: EntitySchema, model: object): Promise<{ elementId: string }> {
    // Validate the model's values (defaults resolved, neode parity) before any write
    validate(modelPropertyValues(model, schema), schema)

    const elementId = await createNodeAndRelationships(this.runner, schema, model)

    return { elementId }
  }
}
