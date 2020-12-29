import Builder from "@neode/querybuilder";
import { THIS_NODE } from "../constants";
import Schema from "../meta/schema";
import NeodeService from "./service";


export default class MergeService extends NeodeService {

    async save(model: Object, schema: Schema) {
        const builder = new Builder()

        const unique = schema.getProperties().filter(property => property.isUnique())
            .map(property => property.getKey())

        // Get Primary/Unique
        const mergeOn = Object.fromEntries(
            unique.map(key => [ key, model[ key ] ])
        )

        builder.merge(THIS_NODE, schema.getLabels(), mergeOn)

        // ON CREATE SET
        // ON MATCH SET

        // SET
        // TODO: Handle @Relationships etc
        Object.keys(model)
            .filter(key => !unique.includes(key))
            .map(key => {
                // TODO: Foo
                builder.set(`${THIS_NODE}.${key}`, model[ key ])
            })

        // TODO: Saving relationships

        // TODO: Eager Loading
        builder.return(THIS_NODE)

        // Build Cypher
        const { cypher, params } = builder.build()

        // Run it!
        return this.transaction.run(cypher, params)
    }
}