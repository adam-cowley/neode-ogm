import { Newable } from "./meta/newable";
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import { Neo4jConnectionProvider } from './driver/neo4j';
import { GraphNode, GraphRelationship } from './driver/types';
import { getModel } from './meta';
import EntitySchema, { EntityType } from './meta/entity/entity-schema';
import RelationshipPropertySchema from './meta/relationship-property-schema';
import PropertySchema, { PropertyType } from './meta/property-schema';
import Neode from './neode.service';
import { EAGER_ID, EAGER_LABELS, EAGER_TYPE } from './query/eager-utils';
import { ELEMENT_ID } from './constants';
import { Direction } from './query';
import { applyEntityMethods } from './entity-methods';

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];

// The full TrustStrategy union in neo4j-driver 6 (legacy driver 4/5 values
// such as TRUST_SIGNED_CERTIFICATES are no longer part of it)
const TRUST_STRATEGIES = [
    'TRUST_ALL_CERTIFICATES',
    'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES',
    'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES',
];

export interface EnvConnectionConfig {
    uri: string;
    auth: ReturnType<typeof neo4j.auth.basic> | undefined;
    config: Record<string, unknown>;
    database: string;
    enterprise: boolean;
}

function warnIgnoring(envVar: string, reason: string): void {
    console.warn(`fromEnv: ignoring ${envVar} — ${reason}`);
}

/**
 * Pure process-env → connection mapping used by fromEnv().
 *
 * Audited against the neo4j-driver 6 config surface:
 * - `encrypted` / `trust` / `trustedCertificates` still exist, but the legacy
 *   `TRUST_SIGNED_CERTIFICATES` value was dropped from `TrustStrategy`
 *   (passed through with a warning).
 * - `knownHosts` and `loadBalancingStrategy` were removed entirely —
 *   warn + ignore.
 * - `logging` must be a `{ level, logger }` object; a raw string throws
 *   "Illegal logger function" at driver construction.
 */
export function configFromEnv(env: NodeJS.ProcessEnv): EnvConnectionConfig {
    const protocol = env.NEO4J_PROTOCOL || 'bolt';
    const host = env.NEO4J_HOST || 'localhost';
    const port = env.NEO4J_PORT || '7687';

    const config: Record<string, unknown> = {};

    const ints: Record<string, string> = {
        NEO4J_MAX_CONNECTION_POOLSIZE: 'maxConnectionPoolSize',
        NEO4J_MAX_TRANSACTION_RETRY_TIME: 'maxTransactionRetryTime',
        NEO4J_MAX_CONNECTION_LIFETIME: 'maxConnectionLifetime',
        NEO4J_CONNECTION_TIMEOUT: 'connectionTimeout',
        NEO4J_CONNECTION_ACQUISITION_TIMEOUT: 'connectionAcquisitionTimeout',
    };

    Object.entries(ints).forEach(([setting, key]) => {
        if (Object.hasOwn(env, setting)) {
            config[key] = parseInt(env[setting] as string, 10);
        }
    });

    if (Object.hasOwn(env, 'NEO4J_DISABLE_LOSSLESS_INTEGERS')) {
        config.disableLosslessIntegers = env.NEO4J_DISABLE_LOSSLESS_INTEGERS === 'true';
    }

    if (Object.hasOwn(env, 'NEO4J_ENCRYPTION')) {
        const value = env.NEO4J_ENCRYPTION as string;

        if (value === 'true' || value === 'ENCRYPTION_ON') {
            config.encrypted = true;
        } else if (value === 'false' || value === 'ENCRYPTION_OFF') {
            config.encrypted = false;
        } else {
            warnIgnoring('NEO4J_ENCRYPTION', `unknown value "${value}"`);
        }
    }

    if (Object.hasOwn(env, 'NEO4J_TRUST')) {
        const value = env.NEO4J_TRUST as string;

        if (!TRUST_STRATEGIES.includes(value)) {
            console.warn(
                `fromEnv: NEO4J_TRUST "${value}" is not a driver 6 trust strategy (${TRUST_STRATEGIES.join(', ')}) — passing through as-is`
            );
        }

        config.trust = value;
    }

    if (Object.hasOwn(env, 'NEO4J_TRUSTED_CERTIFICATES')) {
        config.trustedCertificates = (env.NEO4J_TRUSTED_CERTIFICATES as string).split(',');
    }

    if (Object.hasOwn(env, 'NEO4J_LOGGING_LEVEL')) {
        const level = env.NEO4J_LOGGING_LEVEL as string;

        if (LOG_LEVELS.includes(level)) {
            config.logging = neo4j.logging.console(
                level as 'error' | 'warn' | 'info' | 'debug'
            );
        } else {
            warnIgnoring('NEO4J_LOGGING_LEVEL', `unknown level "${level}"`);
        }
    }

    // shortcut: removed in neo4j-driver 6 — warn + ignore, upgrade if the driver reintroduces them
    ['NEO4J_KNOWN_HOSTS', 'NEO4J_LOAD_BALANCING_STRATEGY'].forEach((setting) => {
        if (Object.hasOwn(env, setting)) {
            warnIgnoring(setting, 'removed in neo4j-driver 6');
        }
    });

    return {
        uri: env.NEO4J_URI || `${protocol}://${host}:${port}`,
        auth:
            env.NEO4J_USERNAME && env.NEO4J_PASSWORD
                ? neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
                : undefined,
        config,
        database: env.NEO4J_DATABASE || 'neo4j',
        enterprise: env.NEO4J_ENTERPRISE === 'true',
    };
}

export function fromEnv(): Neode {
    // Load vars from .env — dotenv does not clobber variables that are
    // already set in process.env
    dotenv.config();

    const { uri, auth, config, database, enterprise } = configFromEnv(process.env);

    const driver = neo4j.driver(uri, auth, config);

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

/**
 * An eager projection map, as produced by the eagerNode/eagerPattern Cypher
 * builders: node or relationship properties inline, plus the __EAGER_ID__
 * (and __EAGER_LABELS__ / __EAGER_TYPE__) markers, plus one key per eager
 * relationship holding the nested projection value(s).
 */
export type EagerProjectionMap = Record<string, unknown>;

/**
 * Eager projections are plain maps carrying the __EAGER_ID__ marker;
 * driver node values never do.
 */
function isEagerProjectionMap(value: unknown): value is EagerProjectionMap {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        EAGER_ID in value
    );
}

export function hydrateNode<T>(
    targetSchema: EntitySchema,
    targetEntity: Newable,
    node: GraphNode | EagerProjectionMap,
    eager: Record<string, EagerRelationship[]> = {}
): T {
    // Wire the active-record instance methods onto the class prototype
    // (idempotent) so hydrated instances can save/update/delete themselves
    applyEntityMethods(targetEntity);

    const entity = new (targetEntity as any)() as Record<string, unknown>;

    // A projection map carries its properties inline with the markers and
    // eager relationship values; a driver node keeps the plain shapes
    const isProjection = isEagerProjectionMap(node);

    let elementId: string | undefined;
    let properties: Record<string, unknown>;
    let eagerValues: Record<string, unknown>;

    if (isProjection) {
        elementId = (node as EagerProjectionMap)[EAGER_ID] as string | undefined;

        // Everything except the reserved markers and the eager relationship
        // keys is a node property
        const reserved = new Set<string>([EAGER_ID, EAGER_LABELS, EAGER_TYPE]);
        targetSchema.getRelationships().forEach((rel) => reserved.add(rel.getKey()));

        properties = Object.fromEntries(
            Object.entries(node).filter(([key]) => !reserved.has(key))
        );

        eagerValues = node;
    } else {
        elementId = (node as GraphNode).elementId;
        properties = (node as GraphNode).properties;
        eagerValues = eager;
    }

    // Stash the elementId so matching works without the deprecated
    // @InternalId property (non-enumerable: not data — must not leak into
    // serialisation or structural copies)
    if (elementId) {
        Object.defineProperty(entity, ELEMENT_ID, { value: elementId });
    }

    targetSchema.getProperties().forEach((property) => {
        switch (property.getType()) {
            case PropertyType.INTERNAL_ID:
                entity[property.getKey()] = elementId;
                break;

            case PropertyType.ALL_PROPERTIES:
                entity[property.getKey()] = properties;
                break;

            case PropertyType.NODE:
                entity[property.getKey()] = node;
                break;

            default:
                entity[property.getKey()] = properties[property.getKey()];
                break;
        }
    });

    // Hydrate Eager Relationships
    targetSchema.getRelationships().forEach((rel) => {
        const key = rel.getKey();

        if (!Object.hasOwn(eagerValues, key) || !eagerValues[key]) return;

        const value = eagerValues[key];

        // Check type - is this a node entity or a relationship entity?
        const targetEntity = rel.getTarget();
        const targetSchema = getModel(targetEntity);

        const values = (Array.isArray(value) ? value : [value]) as unknown[];
        const hydrated = values.map((item) =>
            targetSchema.getType() === EntityType.RelationshipEntity
                ? hydrateRelationship(
                      targetSchema,
                      targetEntity,
                      item as EagerRelationship | EagerProjectionMap,
                      rel,
                      entity
                  )
                : hydrateEagerTargetNode(targetSchema, targetEntity, item)
        );

        if (rel.getMany()) {
            entity[key] = hydrated;
        } else if (hydrated.length) {
            entity[key] = hydrated[0];
        }
    });

    return entity as unknown as T;
}

/**
 * Hydrate one eager value for a node-entity target. Projection maps hydrate
 * recursively; the legacy hand-built shape ({rel, start, end, other}) hydrates
 * from its `other` node.
 */
function hydrateEagerTargetNode(
    targetSchema: EntitySchema,
    targetEntity: Newable,
    item: unknown
): unknown {
    if (isEagerProjectionMap(item)) {
        return hydrateNode(targetSchema, targetEntity, item);
    }

    const legacy = item as EagerRelationship;

    return hydrateNode(targetSchema, targetEntity, legacy.other.node, legacy.other.eager || {});
}

export function hydrateRelationship<T>(
    targetSchema: EntitySchema,
    targetEntity: Newable,
    relObject: EagerRelationship | EagerProjectionMap,
    rel?: RelationshipPropertySchema,
    parent?: unknown
): T {
    // Wire the active-record instance methods onto the class prototype
    // (idempotent) so hydrated instances can save/update/delete themselves
    applyEntityMethods(targetEntity);

    const entity = new (targetEntity as any)() as Record<string, unknown>;

    // Eager projection shape: relationship properties inline with the
    // __EAGER_ID__ / __EAGER_TYPE__ markers, and the node at the far end
    // of the relationship projected under the parent relationship's key
    if (isEagerProjectionMap(relObject)) {
        const record = relObject;
        const direction = rel!.getDirection();
        const relKey = rel!.getKey();
        const farRecord = record[relKey] as EagerProjectionMap | undefined;

        const properties = Object.fromEntries(
            Object.entries(record).filter(
                ([key]) => key !== EAGER_ID && key !== EAGER_TYPE && key !== relKey
            )
        );

        targetSchema.getProperties().forEach((property) => {
            const key = property.getKey();

            switch (property.getType()) {
                case PropertyType.INTERNAL_ID:
                    entity[key] = record[EAGER_ID];
                    break;

                case PropertyType.RELATIONSHIP:
                    // A projection carries no driver relationship object;
                    // the raw map is the closest equivalent
                    entity[key] = record;
                    break;

                case PropertyType.START_NODE:
                case PropertyType.END_NODE:
                case PropertyType.OTHER_NODE: {
                    // The node at the far end of the pattern is the one
                    // projected in the map; the near node is the entity
                    // this relationship hangs off
                    const incoming = direction === Direction.INCOMING;
                    const isFar =
                        property.getType() === PropertyType.OTHER_NODE ||
                        (property.getType() === PropertyType.START_NODE ? incoming : !incoming);

                    if (!isFar) {
                        entity[key] = parent;
                        break;
                    }

                    if (!farRecord) {
                        throw new Error(
                            `Cannot hydrate ${property.getType()} property "${key}": missing node in eager data`
                        );
                    }

                    entity[key] = hydrateNode(
                        getModel(property.getEntity()),
                        property.getEntity(),
                        farRecord
                    );
                    break;
                }

                default:
                    entity[key] = properties[key];
                    break;
            }
        });

        return entity as unknown as T;
    }

    // Legacy hand-built shape: { rel, start, end, other }
    const { rel: graphRel, start, end, other } = relObject as EagerRelationship;

    targetSchema.getProperties().forEach((property) => {
        let value: unknown;

        switch (property.getType()) {
            case PropertyType.INTERNAL_ID:
                value = graphRel.elementId;
                break;

            case PropertyType.RELATIONSHIP:
                value = graphRel;
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
                value = graphRel.properties[property.getKey()];
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

/**
 * The elementId carried by a hydrated entity: the runtime stash written by
 * hydration (every persisted entity has one), or the deprecated @InternalId
 * property for entities hydrated before it existed. Undefined for entities
 * that have never been persisted.
 */
export function elementIdOfEntity(schema: EntitySchema, entity: object): string | undefined {
    const stashed = (entity as Record<symbol, unknown>)[ELEMENT_ID];

    if (typeof stashed === 'string' && stashed.length) {
        return stashed;
    }

    const internalId = schema
        .getProperties()
        .find((property) => property.getType() === PropertyType.INTERNAL_ID);

    const viaProperty = internalId
        ? (entity as Record<string, unknown>)[internalId.getKey()]
        : undefined;

    return typeof viaProperty === 'string' && viaProperty.length ? viaProperty : undefined;
}

/**
 * Match criteria for an entity in a write query: prefer the hydrated
 * elementId (stable, always present on persisted entities), falling back to
 * the primary key property value (neode matched instances by internal id;
 * elementId is its modern, portable equivalent).
 */
export function matchCriteriaForEntity(
    schema: EntitySchema,
    entity: object
): { elementId?: string; key: string; value: unknown } {
    const pk = schema.getPrimaryKey();
    const elementId = elementIdOfEntity(schema, entity);

    if (elementId) {
        // key / value describe the pk fallback match, used only when the
        // caller cannot match by elementId
        return {
            elementId,
            key: pk?.getKey() ?? '',
            value: pk ? (entity as Record<string, unknown>)[pk.getKey()] : undefined,
        };
    }

    if (!pk) {
        throw new Error('Cannot match an entity with no primary key and no elementId');
    }

    const value = (entity as Record<string, unknown>)[pk.getKey()];

    if (value === undefined) {
        throw new Error(
            `Cannot match an entity without a primary key value for "${pk.getKey()}". Did you save it first?`
        );
    }

    return { key: pk.getKey(), value };
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
