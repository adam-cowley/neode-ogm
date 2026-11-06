import { Newable } from "../../meta/newable";
import Builder from '../../query';
import { THIS_NODE } from '../../constants';
import EntitySchema from '../../meta/entity/entity-schema';
import QueryService from './query.service';

export default class GetService extends QueryService {
    async get<T>(
        constructor: Newable,
        schema: EntitySchema,
        params: Record<string, unknown>,
        limit?: number,
        skip?: number
    ): Promise<T[]> {
        const builder = new Builder();

        builder.match(THIS_NODE, schema.getLabels());

        schema.getProperties().forEach((property) => {
            const key = property.getKey();

            if (Object.hasOwn(params, key)) {
                builder.where(`${THIS_NODE}.${key}`, params[key]);
            }
        });

        return this.return<T>(constructor, schema, builder, skip, limit);
    }
}
