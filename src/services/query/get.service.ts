import Builder from "@neode/querybuilder";
import { int } from "neo4j-driver";
import { THIS_NODE } from "../../constants";
import EntitySchema from "../../meta/entity/entity-schema";
import { PropertyType } from "../../meta/property-schema";
import QueryService from "./query.service";

export default class GetService extends QueryService {

    async get<T>(
        constructor: ObjectConstructor,
        schema: EntitySchema,
        params: Record<string, any>,
        limit?: number,
        skip?: number
    ): Promise<T[]> {
        const builder = new Builder()

        builder.match(THIS_NODE, schema.getLabels())

        schema.getProperties().map(property => {
            const key = property.getKey()
            if ( params.hasOwnProperty(key) ) {
                let value = params[ key ]

                // TODO: Validate & convert property types
                switch (property.getType()) {
                    case PropertyType.INTEGER:
                        value = int(value)
                        break;
                }

                builder.where(`${THIS_NODE}.${key}`, value)
            }
        })

        // Run it!
        return this.return<T>(constructor, schema, builder, skip, limit)
    }
}