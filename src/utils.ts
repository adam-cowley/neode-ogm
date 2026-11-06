import { Newable } from "./meta/newable";
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import { Neo4jConnectionProvider } from './driver/neo4j';
import { GraphNode, GraphRelationship } from './driver/types';
import { getModel } from './meta';
import EntitySchema, { EntityType } from './meta/entity/entity-schema';
import PropertySchema, { PropertyType } from './meta/property-schema';
import Neode from './neode.service';

export function fromEnv(): Neode {
    // Load vars from .env
    dotenv.config();

    const protocol = process.env.NEO4J_PROTOCOL || 'bolt';
    const host = process.env.NEO4J_HOST || 'localhost';
    const port = process.env.NEO4J_PORT || '7687';
    const connection_string = process.env.NEO4J_URI || `${protocol}://${host}:${port}`;
    const username = process.env.NEO4J_USERNAME;
    const password = process.env.NEO4J_PASSWORD;
    const enterprise = process.env.NEO4J_ENTERPRISE === 'true';

    // Multi-database
    const database = process.env.NEO4J_DATABASE || 'neo4j';

    // Build additional config
    const config: Record<string, unknown> = {};

    const settings: Record<string, string> = {
        NEO4J_MAX_CONNECTION_POOLSIZE: 'maxConnectionPoolSize',
        NEO4J_MAX_TRANSACTION_RETRY_TIME: 'maxTransactionRetryTime',
        NEO4J_LOAD_BALANCING_STRATEGY: 'loadBalancingStrategy',
        NEO4J_MAX_CONNECTION_LIFETIME: 'maxConnectionLifetime',
        NEO4J_CONNECTION_TIMEOUT: 'connectionTimeout',
        NEO4J_CONNECTION_ACQUISITION_TIMEOUT: 'connectionAcquisitionTimeout',
        NEO4J_DISABLE_LOSSLESS_INTEGERS: 'disableLosslessIntegers',
        NEO4J_LOGGING_LEVEL: 'logging',
        NEO4J_ENCRYPTED: 'encrypted',
        NEO4J_TRUST: 'trust',
        NEO4J_TRUSTED_CERTIFICATES: 'trustedCertificates',
        NEO4J_KNOWN_HOSTS: 'knownHosts',
    };

    Object.keys(settings).forEach((setting) => {
        if (Object.hasOwn(process.env, setting)) {
            const key = settings[setting];
            let value: unknown = process.env[setting];

            if (key === 'trustedCertificates' || key === 'knownHosts') {
                value = (value as string).split(',');
            } else if (
                key === 'disableLosslessIntegers' ||
                key === 'encrypted'
            ) {
                value = value === 'true';
            } else if (
                key === 'maxTransactionRetryTime' ||
                key === 'connectionTimeout' ||
                key === 'connectionAcquisitionTimeout' ||
                key === 'maxConnectionPoolSize' ||
                key === 'maxConnectionLifetime'
            ) {
                value = parseInt(value as string, 10);
            }

            config[key] = value;
        }
    });

    const driver = neo4j.driver(
        connection_string,
        username && password ? neo4j.auth.basic(username, password) : undefined,
        config
    );

    return new Neode(new Neo4jConnectionProvider(driver, database), enterprise);
}

export interface EagerNode {
    node: GraphNode;
    eager?: Record<string, EagerRelationship[]>;
}

export interface EagerRelationship {
    rel: GraphRelationship;
    start: EagerNode;
    end: EagerNode;
    other: EagerNode;
}

export function hydrateNode<T>(
    targetSchema: EntitySchema,
    targetEntity: Newable,
    node: GraphNode,
    eager: Record<string, EagerRelationship[]> = {}
): T {
    const entity = new (targetEntity as any)() as Record<string, unknown>;

    targetSchema.getProperties().forEach((property) => {
        switch (property.getType()) {
            case PropertyType.INTERNAL_ID:
                entity[property.getKey()] = node.elementId;
                break;

            case PropertyType.ALL_PROPERTIES:
                entity[property.getKey()] = node.properties;
                break;

            case PropertyType.NODE:
                entity[property.getKey()] = node;
                break;

            default:
                entity[property.getKey()] = node.properties[property.getKey()];
                break;
        }
    });

    // Hydrate Eager Relationships
    targetSchema.getRelationships().forEach((rel) => {
        const key = rel.getKey();

        if (!Object.hasOwn(eager, key) || !eager[key]) return;

        const value = eager[key];

        // Check type - is this a node entity or a relationship entity?
        const targetEntity = rel.getTarget();
        const targetSchema = getModel(targetEntity);

        if (targetSchema.getType() === EntityType.RelationshipEntity) {
            // If the target is a relationship entity then hydrate it differently
            if (rel.getMany()) {
                entity[key] = value.map((item) =>
                    hydrateRelationship(targetSchema, targetEntity, item)
                );
            } else {
                if (value.length) {
                    entity[key] = hydrateRelationship(targetSchema, targetEntity, value[0]);
                }
            }
        } else {
            if (rel.getMany()) {
                entity[key] = value.map((item) =>
                    hydrateNode(targetSchema, targetEntity, item.other.node, item.other.eager)
                );
            } else {
                if (value.length) {
                    entity[key] = hydrateNode(
                        targetSchema,
                        targetEntity,
                        value[0].other.node,
                        value[0].other.eager || {}
                    );
                }
            }
        }
    });

    return entity as unknown as T;
}

export function hydrateRelationship<T>(
    targetSchema: EntitySchema,
    targetEntity: Newable,
    relObject: EagerRelationship
): T {
    const entity = new (targetEntity as any)() as Record<string, unknown>;

    const { rel, start, end, other } = relObject;

    targetSchema.getProperties().forEach((property) => {
        let value: unknown;

        switch (property.getType()) {
            case PropertyType.INTERNAL_ID:
                value = rel.elementId;
                break;

            case PropertyType.RELATIONSHIP:
                value = rel;
                break;

            case PropertyType.START_NODE:
            case PropertyType.END_NODE:
            case PropertyType.OTHER_NODE: {
                const eagerSchema = getModel(property.getEntity());
                const eagerEntity = property.getEntity();

                let innerNode: GraphNode | undefined;
                let innerEager: Record<string, EagerRelationship[]> = {};

                // Work out which node to hydrate
                if (property.getType() === PropertyType.START_NODE) {
                    innerNode = start.node;
                    innerEager = start.eager || {};
                } else if (property.getType() === PropertyType.END_NODE) {
                    innerNode = end.node;
                    innerEager = end.eager || {};
                } else if (property.getType() === PropertyType.OTHER_NODE) {
                    innerNode = other.node;
                    innerEager = other.eager || {};
                }

                if (!innerNode) {
                    throw new Error(
                        `Cannot hydrate ${property.getType()} property "${property.getKey()}": missing node in eager data`
                    );
                }

                value = hydrateNode(eagerSchema, eagerEntity, innerNode, innerEager);
                break;
            }

            default:
                value = rel.properties[property.getKey()];
                break;
        }

        entity[property.getKey()] = value;
    });


    return entity as unknown as T;
}

export function setPropertyInBuilder(
    builder: import('./query').default,
    alias: string,
    property: PropertySchema,
    value: unknown
): import('./query').default {
    if (value === undefined || value === null) {
        return builder.delete(`${alias}.${property.getKey()}`);
    }

    // Ignore Internal IDs, properties and nodes
    if (
        property.getType() === PropertyType.INTERNAL_ID ||
        property.getType() === PropertyType.ALL_PROPERTIES ||
        property.getType() === PropertyType.NODE
    ) {
        return builder;
    }

    // TODO: Handle complex types (temporals, points) — Phase 4
    const set = `${alias}.${property.getKey()}`;

    // Only set primary key on create
    if (property.isPrimaryKey()) {
        builder.onCreateSet(set, value);

        return builder;
    }

    // On create set
    if (property.getOnCreateSet()) {
        builder.onCreateSet(set, value);
    }

    // On match set
    if (property.getOnMatchSet()) {
        builder.onMatchSet(set, value);
    }

    // Always set
    if (
        (property.getOnCreateSet() === false && property.getOnMatchSet() === false) ||
        property.getAlwaysSet() === true ||
        property.isUnique() === true
    ) {
        builder.set(set, value);
    }

    return builder;
}

export function getValuesAsRecord(
    model: object,
    properties: PropertySchema[],
    _schema: EntitySchema
): Record<string, unknown> {
    return Object.fromEntries(
        properties
            .map((property) => {
                const key = property.getKey();

                // Merge matching only uses explicitly-set values:
                // resolving defaults here would generate a new value
                // (e.g. a fresh UUID) on every save and never match
                if (Object.hasOwn(model, key)) {
                    const value = (model as Record<string, unknown>)[key];

                    if (value !== undefined) {
                        return [key, value];
                    }
                }

                return undefined;
            })
            .filter((entry) => entry !== undefined)
    );
}

export function getValueOrDefault(
    model: object,
    property: PropertySchema,
    schema: EntitySchema
): unknown {
    const key = property.getKey();

    if (Object.hasOwn(model, key) && (model as Record<string, unknown>)[key] !== undefined) {
        return (model as Record<string, unknown>)[key];
    }

    const defaultValue = property.getDefaultValue();

    if (typeof defaultValue === 'function') {
        return defaultValue(model, schema);
    }

    return defaultValue;
}
