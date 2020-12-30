import Builder from "@neode/querybuilder";
import { THIS_NODE } from "../constants";
import Schema from "../meta/schema";
import QueryService from "./query.service";

export default class DeleteService extends QueryService {

    async delete<T extends Object>(schema: Schema, entity: T): Promise<void> {
        const builder = new Builder()

        const primaryKey = schema.getProperties().find(property => property.isPrimaryKey()).getKey()
        const value = entity[ primaryKey ]

        // TODO: Convert value
        builder.match(THIS_NODE, schema.getLabels(), { [primaryKey]: value })
            .delete()

        // TODO: Eager delete

        const { cypher, params } = builder.build()

        // Delete it
        await this.transaction.run(cypher, params)
    }

}