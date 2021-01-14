import Builder, { Direction } from "@neode/querybuilder";
import { Integer, QueryResult } from "neo4j-driver";
import { INTERNAL_ID, THIS_NODE } from "../../constants";
import { getModel } from "../../meta";
import EntitySchema, { EntityType } from "../../meta/entity/entity-schema";
import PropertySchema, { PropertyType } from "../../meta/property-schema";
import RelationshipPropertySchema from "../../meta/relationship-property-schema";
import { setPropertyInBuilder } from "../../utils";
import QueryService from "./query.service";
export default class MergeService extends QueryService {

    async save(model: Object, schema: EntitySchema): Promise<QueryResult> {
        const builder = new Builder()

        const unique = schema.getProperties().filter(property => property.isUnique())
            .map(property => property.getKey())

        // Get Primary/Unique
        const mergeOn = Object.fromEntries(
            unique.map(key => [ key, model[ key ] ])
        )

        builder.merge(THIS_NODE, schema.getLabels(), mergeOn)

        // Set Properties
        // TODO: ON CREATE SET
        // TODO: ON MATCH SET
        // TODO: Default values
        schema.getProperties()
            .filter(property => !property.isUnique())
            .map(property => {
                const key = property.getKey()
                const value = model[ key ]

                // If property is not set then ignore it
                if ( model.hasOwnProperty(key) ) {
                    setPropertyInBuilder(builder, THIS_NODE, property, value)
                }
            })

        builder.return(THIS_NODE, `id(${THIS_NODE}) as ${INTERNAL_ID}`)

        // Build Cypher
        const { cypher, params } = builder.build()

        // Run it!
        const result = await this.transaction.run(cypher, params)

        // Get Internal ID
        const thisId = result.records[0].get(THIS_NODE).identity

        // Save relationship nodes in same transaction
        await Promise.all(
            schema.getRelationships()
                .map(async rel => {
                    const key = rel.getKey()

                    const targetEntity = rel.getTarget()
                    const targetSchema = getModel(targetEntity)

                    // If property is not set then ignore it
                    if ( model.hasOwnProperty(key) ) {
                        const values = rel.getMany() ? model[ key ] : [ model[ key ] ]

                        if ( targetSchema.getType() === EntityType.RelationshipEntity ) {
                            return Promise.all(values.map(async value => {
                                // Save Node at other end
                                let otherProperty: PropertySchema

                                if ( rel.getDirection() === Direction.OUTGOING ) {
                                    otherProperty = targetSchema.getProperties().find(property => property.getType() === PropertyType.END_NODE || property.getType() === PropertyType.OTHER_NODE )
                                }
                                else if ( rel.getDirection() === Direction.INCOMING ) {
                                    otherProperty = targetSchema.getProperties().find(property => property.getType() === PropertyType.START_NODE || property.getType() === PropertyType.OTHER_NODE )
                                }

                                const otherEntity = otherProperty.getEntity()
                                const otherSchema = getModel(otherEntity)

                                // TODO: Validate the other object
                                const otherModel = value[ otherProperty.getKey() ]

                                const res = await this.save(otherModel, otherSchema)

                                const toId = res.records[0].get(INTERNAL_ID)

                                // Call the function to create the relationship
                                await this.relateNodes(thisId, toId, rel, targetSchema, value)
                            }))
                        }


                        return Promise.all(values.map(async value => {
                            // Save Node
                            const res = await this.save(value, targetSchema)

                            // Get Internal Id
                            const toId = res.records[0].get(INTERNAL_ID)

                            // Relate the two nodes together
                            return this.relateNodes(thisId, toId, rel, targetSchema, value)
                        }))
                    }

                    return Promise.resolve()
                })
        )


        return result
    }

    private relateNodes<T>(fromId: Integer, toId: Integer, rel: RelationshipPropertySchema, targetSchema: EntitySchema, entity: T): Promise<QueryResult> {
        const fromNode = 'from'
        const toNode = 'to'
        const thisRel = 'rel'

        const builder = new Builder()

        // Match nodes
        builder.match(fromNode).whereId(fromNode, fromId.toNumber())
            .match(toNode).whereId(toNode, toId.toNumber())

            // Merge Relationship
            .merge(fromNode)
                .relationship(rel.getType(), rel.getDirection(), thisRel)
                .to(toNode)


        // Set relationship Properties
        if ( targetSchema.getType() === EntityType.RelationshipEntity ) {
            targetSchema.getProperties()
                .map(property => {
                    const key = property.getKey()

                    // Ignore if not set
                    if ( !entity.hasOwnProperty(key) ) return;

                    const value = entity[ key ]

                    switch ( property.getType() ) {
                        // Ignore any internals
                        case PropertyType.INTERNAL_ID:
                        case PropertyType.START_NODE:
                        case PropertyType.END_NODE:
                        case PropertyType.OTHER_NODE:
                            break;

                        case PropertyType.ALL_PROPERTIES:
                            Object.entries(value)
                                .map(([ key, value ]) => setPropertyInBuilder(builder, thisRel, property, value))
                            break;

                        default:
                            setPropertyInBuilder(builder, thisRel, property, value)
                            break;
                    }

                })

        }

        // Object.entries(properties)
        //     .forEach(([ key, value ]) => {
        //         console.log(key, value);

        //     })

        const { cypher, params } = builder.build()

        return this.transaction.run(cypher, params)
    }
}