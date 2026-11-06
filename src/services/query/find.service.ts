import { Newable } from "../../meta/newable";
import Builder from '../../query';
import { THIS_NODE } from '../../constants';
import EntitySchema from '../../meta/entity/entity-schema';
import QueryService from './query.service';

export default class FindService extends QueryService {
    async find(
        constructor: Newable,
        schema: EntitySchema,
        value: unknown
    ): Promise<unknown | undefined> {
        const builder = new Builder();

        const primaryKey = schema.getPrimaryKey()!.getKey();

        builder.match(THIS_NODE, schema.getLabels(), { [primaryKey]: value });

        return this.returnFirst(constructor, schema, builder);
    }
}
