import type EntitySchema from '../../meta/entity/entity-schema.js'
import { applyFakeValues, createNodeAndRelationships, modelPropertyValues } from '../write-utils.js'
import { validate } from '../../validation/index.js'
import QueryService from './query.service.js'

export default class CreateService extends QueryService {
  /**
  CREATE a node for the given schema and model, recursively creating and
  relating any nested relationship targets
  */
  async create(schema: EntitySchema, model: object): Promise<{ elementId: string }> {
    // Resolve the schema's `fake` generators onto the model first
    // (NTS-444): fake runs before validation, after explicit values and
    // defaults, so validation and the write see the same value
    applyFakeValues(schema, model)

    // Validate the model's values (defaults resolved, neode parity) before any write
    validate(modelPropertyValues(model, schema), schema)

    const elementId = await createNodeAndRelationships(this.runner, schema, model)

    return { elementId }
  }
}
