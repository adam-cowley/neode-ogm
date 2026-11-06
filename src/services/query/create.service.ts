import EntitySchema from '../../meta/entity/entity-schema';
import { createNodeAndRelationships } from '../write-utils';
import QueryService from './query.service';

export default class CreateService extends QueryService {
    /**
     * CREATE a node for the given schema and model, recursively creating and
     * relating any nested relationship targets
     */
    async create(schema: EntitySchema, model: object): Promise<{ elementId: string }> {
        const elementId = await createNodeAndRelationships(this.runner, schema, model);

        return { elementId };
    }
}
