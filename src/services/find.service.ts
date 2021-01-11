import Builder from "@neode/querybuilder";
import { THIS_NODE } from "../constants";
import EntitySchema from "../meta/entity/entity-schema";
import QueryService from "./query.service";

export default class FindService extends QueryService {

    async find(constructor: ObjectConstructor, schema: EntitySchema, value: any): Promise<any | undefined> {
        const builder = new Builder()

        const primaryKey = schema.getProperties().find(property => property.isPrimaryKey()).getKey()

        // TODO: Convert value
        builder.match(THIS_NODE, schema.getLabels(), { [primaryKey]: value })

        // Run it!
        return this.returnFirst(constructor, schema, builder)
    }
}