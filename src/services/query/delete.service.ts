import Builder from '../../query';
import { THIS_NODE } from '../../constants';
import EntitySchema from '../../meta/entity/entity-schema';
import QueryService from './query.service';

export default class DeleteService extends QueryService {
    async delete<T extends object>(schema: EntitySchema, entity: T): Promise<void> {
        const builder = new Builder();

        const primaryKey = schema
            .getProperties()
            .find((property) => property.isPrimaryKey())!.getKey();
        const value = (entity as Record<string, unknown>)[primaryKey];

        // TODO: Eager delete (cascade) — Phase 4
        builder.match(THIS_NODE, schema.getLabels(), { [primaryKey]: value }).detachDelete(THIS_NODE);

        const { query, params } = builder.build();

        await this.runner.run(query, params);
    }
}
