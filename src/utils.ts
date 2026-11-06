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

/**
 * Spatial Reference System Identifiers used by Neo4j for point properties
 *
 * @see https://neo4j.com/docs/cypher/current/syntax/spatial/
 */
const SRID = {
    CARTESIAN_2D: 7203,
    CARTESIAN_3D: 9157,
    WGS_84_2D: 4326,
    WGS_84_3D: 4979,
} as const;

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && !Number.isNaN(value);
}

function describeValue(value: unknown): string {
    return typeof value === 'string' ? `"${value}"` : String(value);
}

function isDriverValue(value: unknown): boolean {
    return (
        neo4j.isDate(value) ||
        neo4j.isDateTime(value) ||
        neo4j.isDuration(value) ||
        neo4j.isInt(value) ||
        neo4j.isLocalDateTime(value) ||
        neo4j.isLocalTime(value) ||
        neo4j.isPoint(value) ||
        neo4j.isTime(value)
    );
}

/**
 * Convert a value into a Neo4j temporal value. Strings are parsed by the
 * driver (exact, timezone-safe), numbers are treated as epoch milliseconds
 * and JavaScript Dates are converted with the driver's fromStandardDate().
 * Any other value is returned unchanged.
 */
function convertTemporal(
    value: unknown,
    fromString: (value: string) => unknown,
    fromStandardDate: (date: Date) => unknown
): unknown {
    if (typeof value === 'string') {
        return fromString(value);
    }

    if (typeof value === 'number') {
        return fromStandardDate(new Date(value));
    }

    if (value instanceof Date) {
        return fromStandardDate(value);
    }

    return value;
}

function convertPoint(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError(
            `Cannot convert ${describeValue(value)} to a neo4j Point: expected an object`
        );
    }

    const { x, y, z, latitude, longitude, height } = value as Record<string, unknown>;

    // Cartesian coordinates
    if (isNumber(x)) {
        if (!isNumber(y)) {
            throw new TypeError('Cannot convert object to a neo4j Point: expected a numeric "y" to accompany "x"');
        }

        if (isNumber(z)) {
            return new neo4j.Point(SRID.CARTESIAN_3D, x, y, z);
        }

        return new neo4j.Point(SRID.CARTESIAN_2D, x, y);
    }

    // WGS 84 (geographic) coordinates: Neo4j stores longitude as x, latitude as y
    if (isNumber(latitude) || isNumber(longitude)) {
        if (!isNumber(latitude) || !isNumber(longitude)) {
            throw new TypeError('Cannot convert object to a neo4j Point: expected numeric "latitude" and "longitude"');
        }

        if (isNumber(height)) {
            return new neo4j.Point(SRID.WGS_84_3D, longitude, latitude, height);
        }

        return new neo4j.Point(SRID.WGS_84_2D, longitude, latitude);
    }

    throw new TypeError(
        'Cannot convert object to a neo4j Point: expected { x, y[, z] } or { latitude, longitude[, height] }'
    );
}

function convertDuration(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError(
            `Cannot convert ${describeValue(value)} to a neo4j Duration: expected an object`
        );
    }

    const { months, days, seconds, nanoseconds } = value as Record<string, unknown>;

    if (!isNumber(months) || !isNumber(days) || !isNumber(seconds) || !isNumber(nanoseconds)) {
        throw new TypeError(
            'Cannot convert object to a neo4j Duration: expected numeric { months, days, seconds, nanoseconds }'
        );
    }

    return new neo4j.Duration(months, days, seconds, nanoseconds);
}

function parseNumber(value: unknown): number {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        return Number(value);
    }

    return NaN;
}

function convertInteger(value: unknown): number {
    const parsed = parseNumber(value);

    if (!Number.isInteger(parsed)) {
        throw new TypeError(`Expected an integer, received ${describeValue(value)}`);
    }

    return parsed;
}

function convertFloat(value: unknown): number {
    const parsed = parseNumber(value);

    if (Number.isNaN(parsed)) {
        throw new TypeError(`Expected a number, received ${describeValue(value)}`);
    }

    return parsed;
}

function convertSingleValue(value: unknown, type: PropertyType): unknown {
    // Nullish values indicate an un-set property; unsetting is handled upstream
    if (value === null || value === undefined) {
        return value;
    }

    // Values that are already Neo4j driver instances pass through untouched
    if (isDriverValue(value)) {
        return value;
    }

    switch (type) {
        case PropertyType.DATE:
            return convertTemporal(
                value,
                (str) => neo4j.Date.fromString(str),
                (date) => neo4j.Date.fromStandardDate(date)
            );

        case PropertyType.TIME:
            return convertTemporal(
                value,
                (str) => neo4j.Time.fromString(str),
                (date) => neo4j.Time.fromStandardDate(date)
            );

        case PropertyType.DATETIME:
            return convertTemporal(
                value,
                (str) => neo4j.DateTime.fromString(str),
                (date) => neo4j.DateTime.fromStandardDate(date)
            );

        case PropertyType.LOCALTIME:
            return convertTemporal(
                value,
                (str) => neo4j.LocalTime.fromString(str),
                (date) => neo4j.LocalTime.fromStandardDate(date)
            );

        case PropertyType.LOCALDATETIME:
            return convertTemporal(
                value,
                (str) => neo4j.LocalDateTime.fromString(str),
                (date) => neo4j.LocalDateTime.fromStandardDate(date)
            );

        case PropertyType.POINT:
            return convertPoint(value);

        case PropertyType.DURATION:
            return convertDuration(value);

        case PropertyType.INTEGER:
            return convertInteger(value);

        case PropertyType.FLOAT:
        case PropertyType.NUMBER:
            return convertFloat(value);

        default:
            return value;
    }
}

/**
 * Convert a JavaScript value into the matching Neo4j driver value for the
 * given property. Temporal strings and dates become driver temporal values,
 * points and durations are built from plain objects and numbers are validated
 * and passed through as plain numbers (the driver's Integer type is not used).
 *
 * Arrays are converted element-by-element when the property is an array, and
 * values that need no conversion (strings, booleans, driver values, etc) are
 * returned unchanged.
 */
export function convertPropertyValue(value: unknown, property: PropertySchema): unknown {
    if (property.isArray() && Array.isArray(value)) {
        return value.map((element) => convertSingleValue(element, property.getType()));
    }

    return convertSingleValue(value, property.getType());
}
