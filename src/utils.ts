import Builder from '@neode/querybuilder';
import neo4j, { int, Node, Relationship } from 'neo4j-driver'
import { getModel } from './meta';
import EntitySchema, { EntityType } from './meta/entity/entity-schema';
import PropertySchema, { PropertyType } from './meta/property-schema';
import Neode from './neode.service'


export function fromEnv(): Neode {
    // Load vars from .env
    require('dotenv').config();

    const connection_string = `${process.env.NEO4J_PROTOCOL}://${process.env.NEO4J_HOST}:${process.env.NEO4J_PORT}`;
    const username = process.env.NEO4J_USERNAME;
    const password = process.env.NEO4J_PASSWORD;
    const enterprise = process.env.NEO4J_ENTERPRISE === 'true';

    // Multi-database
    const database = process.env.NEO4J_DATABASE || 'neo4j';

    // Build additional config
    const config = {};

    const settings = {
        NEO4J_MAX_CONNECTION_POOLSIZE: 'maxConnectionPoolSize',
        NEO4J_MAX_TRANSACTION_RETRY_TIME: 'maxTransactionRetryTime',
        NEO4J_LOAD_BALANCING_STRATEGY: 'loadBalancingStrategy',
        NEO4J_MAX_CONNECTION_LIFETIME: 'maxConnectionLifetime',
        NEO4J_CONNECTION_TIMEOUT: 'connectionTimeout',
        NEO4J_DISABLE_LOSSLESS_INTEGERS: 'disableLosslessIntegers',
        NEO4J_LOGGING_LEVEL: 'logging',
    };

    Object.keys(settings).forEach(setting => {
        if ( process.env.hasOwnProperty(setting) ) {
            const key = settings[ setting ];
            let value: any = process.env[ setting ];

            if ( key == "trustedCertificates" ) {
                value = value.split(',');
            }
            else if ( key == "disableLosslessIntegers" ) {
                value = value === 'true';
            }
            else if ( key == 'maxTransactionRetryTime' || key == 'connectionTimeout' || key == 'connectionAcquisitionTimeout' ) {
                value = parseInt(value)
            }

            config[ key ] = value;
        }
    });

    const driver = neo4j.driver(connection_string, neo4j.auth.basic(username, password))

    return new Neode(driver,database, enterprise)
}

export interface EagerNode {
    node: Node;
    eager?: Record<string, EagerRelationship[]>
}

export interface EagerRelationship {
    rel: Relationship;
    start: EagerNode;
    end: EagerNode;
    other: EagerNode;
}


export function hydrateNode<T>(targetSchema: EntitySchema, targetEntity: ObjectConstructor | Function, node: Node, eager: Record<string, EagerRelationship[]>): T {
    const entity = new targetEntity as T

    targetSchema.getProperties().map(property => {
        switch ( property.getType() ) {
            case PropertyType.INTERNAL_ID:
                entity[ property.getKey() ] = node.identity.toNumber()
                break;

            case PropertyType.ALL_PROPERTIES:
                // TODO: Convert property to native
                entity[ property.getKey() ] = node.properties
                break;

            case PropertyType.NODE:
                entity[ property.getKey() ] = node
                break;

            case PropertyType.INTEGER:
                entity[ property.getKey() ] = node.properties[ property.getKey() ].toNumber()
                break;

            default:
                entity[ property.getKey() ] = node.properties[ property.getKey() ]
                break
        }
    })

    // Hydrate Eager Relationship
    targetSchema.getRelationships()
        .map((rel) => {
            const key = rel.getKey()

            if ( !eager.hasOwnProperty(key) ) return

            const value = eager[ key ]

            // Check type - is this a node entity or a relationship entity?
            const targetEntity = rel.getTarget()
            const targetSchema = getModel(targetEntity)


            if ( targetSchema.getType() === EntityType.RelationshipEntity ) {
                // If the node is a relationship entity then hydrate it differently
                if ( rel.getMany() ) {
                    entity[ key ] = value.map(item => hydrateRelationship(targetSchema, targetEntity, item))
                }
                else {
                    if ( value.length ) entity[ key ] = hydrateRelationship(targetSchema, targetEntity, value[0])
                }
            }
            else {
                if ( rel.getMany() ) {
                    entity[ key ] = value.map(item => hydrateNode(targetSchema, targetEntity, item.other.node, item.other.eager))
                }
                else {
                    if ( value.length ) entity[ key ] = hydrateNode(targetSchema, targetEntity, value[0].other.node, value[0].other.eager || {})
                }
            }
        })

    return entity
}


export function hydrateRelationship<T>(targetSchema: EntitySchema, targetEntity: ObjectConstructor | Function, relObject: EagerRelationship): T {
    const entity = new targetEntity as T

    const { rel, start, end, other } = relObject

    targetSchema.getProperties().map(property => {
        let value

        switch ( property.getType() ) {
            case PropertyType.INTERNAL_ID:
                value = rel.identity.toNumber()
                break;

            case PropertyType.RELATIONSHIP:
                value = rel
                break;

            case PropertyType.START_NODE:
            case PropertyType.END_NODE:
            case PropertyType.OTHER_NODE:
                const eagerSchema = getModel(property.getEntity())
                const eagerEntity = property.getEntity()

                let innerNode: Node
                let innerEager: Record<string, EagerRelationship[]>

                // Work out which node to hydrate
                if ( property.getType() === PropertyType.START_NODE ) {
                    innerNode = start.node
                    innerEager = start.eager
                }
                else if ( property.getType() === PropertyType.END_NODE ) {
                    innerNode = end.node
                    innerEager = end.eager
                }
                else if ( property.getType() === PropertyType.END_NODE ) {
                    innerNode = other.node
                    innerEager = other.eager
                }

                value = hydrateNode(eagerSchema, eagerEntity, innerNode, innerEager)
                break;

            default:
                value = rel.properties[ property.getKey() ]
                break;

        }

        entity[ property.getKey() ] = value
    })

    return entity
}

export function setPropertyInBuilder<T>(builder: Builder<T>, alias: string, property: PropertySchema, value: any): Builder<T> {
    if ( value === undefined || value === null ) {
        return builder.delete(`${alias}.${property.getKey()}`)
    }

    // Ignore Internal IDs, properties and nodes
    if ( property.getType() === PropertyType.INTERNAL_ID || property.getType() === PropertyType.ALL_PROPERTIES || property.getType() === PropertyType.NODE ) {
        return builder
    }

    // TODO: Handle complex types
    // Convert Integer
    if ( property.getType() === PropertyType.INTEGER ) {
        value = int(value)
    }

    const set = `${alias}.${property.getKey()}`

    // Only set primary key on create
    if ( property.isPrimaryKey() ) {
        builder.onCreateSet(set, value)

        return builder;
    }

    // On create set
    if ( property.getOnCreateSet() ) {
        builder.onCreateSet(set, value)
    }

    // On match set
    if ( property.getOnMatchSet() ) {
        builder.onMatchSet(set, value)
    }

    // Always set
    if ( ( property.getOnCreateSet() === false && property.getOnMatchSet() === false ) || property.getAlwaysSet() === true || property.isUnique() === true ) {
        builder.set(set, value)
    }

    return builder
}

export function getValuesAsRecord(model: Object, properties: PropertySchema[], schema: EntitySchema): Record<string, any> {
    return Object.fromEntries(
        properties.map(property => {
            const key = property.getKey()

            const value = getValueOrDefault(model, property, schema)

            if ( value !== undefined ) {
                return [ key, value ]
            }

            return undefined
        })
        .filter(key => key !== undefined)
    )
}

export function getValueOrDefault(model: Object, property: PropertySchema, schema: EntitySchema): any {
    const key = property.getKey()

    if ( model.hasOwnProperty(key) && model[ key ] !== undefined ) {
        return model[ key ]
    }

    let defaultValue = property.getDefaultValue()

    if ( typeof defaultValue === 'function' ) {
        return defaultValue(model, schema)
    }

    return defaultValue
}