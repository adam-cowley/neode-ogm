import Builder from "@neode/querybuilder";
import { Integer } from "neo4j-driver";
import { THIS_NODE } from "../../constants";
import EntitySchema from "../../meta/entity/entity-schema";
import QueryService from "./query.service";

export default class FindByIdService extends QueryService {

    async find(constructor: ObjectConstructor | Function, schema: EntitySchema, id: number | Integer): Promise<any | undefined> {
        const builder = new Builder()

        builder.match(THIS_NODE)
            .whereId(THIS_NODE, id as number)


        // Run it!
        return this.returnFirst(constructor, schema, builder)
    }
}