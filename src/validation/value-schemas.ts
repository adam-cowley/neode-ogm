import { z } from 'zod';
import neo4j from 'neo4j-driver';

/**
 * Zod schemas for the property value types that are not plain JSON.
 *
 * Each schema accepts BOTH plain JavaScript input (what a user writes in
 * code — validation runs on input values before convertPropertyValue) and
 * the already-converted Neo4j driver instances (what comes back from the
 * database or from a second pass after conversion).
 */

/** Spatial Reference System Identifiers used by Neo4j for point properties */
const SRID = {
    CARTESIAN_2D: 7203,
    CARTESIAN_3D: 9157,
    WGS_84_2D: 4326,
    WGS_84_3D: 4979,
} as const;

const POINT_SRIDS: number[] = Object.values(SRID);

// Scalar bases for the rule table
export const stringSchema = z.string();
export const booleanSchema = z.boolean();
export const floatSchema = z.number();

/** NUMBER properties accept the same values as FLOAT properties */
export const numberSchema = z.number();

export const uuidSchema = z.uuid();
export const anySchema = z.any();

/**
 * INTEGER accepts native numbers and Neo4j Integer instances — the port of
 * neode's `neoInteger` Joi extension (Joi.number().integer() alternatives
 * Joi.object().type(neo4j.types.Integer)).
 */
export const integerSchema: z.ZodType = z.union([
    z.number().int(),
    z.custom(value => neo4j.isInt(value)),
]);

/**
 * A temporal value is valid when it is the driver instance itself, a
 * JavaScript Date, epoch milliseconds, or a string the driver can parse
 * exactly (the same contract as convertPropertyValue, so anything that
 * validates here will convert cleanly afterwards).
 */
function temporalSchema(
    isInstance: (value: unknown) => boolean,
    fromString: (value: string) => unknown,
    label: string
): z.ZodType {
    return z.custom(value => {
        if (isInstance(value)) return true;

        if (value instanceof Date) return true;

        if (typeof value === 'number') {
            return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime());
        }

        if (typeof value === 'string') {
            try {
                fromString(value);

                return true;
            } catch {
                return false;
            }
        }

        // Structural check for other engine value classes (e.g. the embedded
        // Relate engine's CypherDate-style objects): accepted when their
        // string form parses like the driver's own values
        if (typeof value === 'object') {
            try {
                fromString(String(value));

                return true;
            } catch {
                return false;
            }
        }

        return false;
    }, { message: `Expected a ${label} value (parseable string, Date, epoch number or driver instance)` });
}

export const dateSchema: z.ZodType = temporalSchema(
    value => neo4j.isDate(value),
    value => neo4j.Date.fromString(value),
    'Neo4j Date'
);

export const timeSchema: z.ZodType = temporalSchema(
    value => neo4j.isTime(value),
    value => neo4j.Time.fromString(value),
    'Neo4j Time'
);

export const datetimeSchema: z.ZodType = temporalSchema(
    value => neo4j.isDateTime(value),
    value => neo4j.DateTime.fromString(value),
    'Neo4j DateTime'
);

export const localtimeSchema: z.ZodType = temporalSchema(
    value => neo4j.isLocalTime(value),
    value => neo4j.LocalTime.fromString(value),
    'Neo4j LocalTime'
);

export const localdatetimeSchema: z.ZodType = temporalSchema(
    value => neo4j.isLocalDateTime(value),
    value => neo4j.LocalDateTime.fromString(value),
    'Neo4j LocalDateTime'
);

function isCoordinate(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A point is valid when it is a driver Point instance with a Neo4j SRID, or
 * a plain { x, y[, z] } cartesian object or { latitude, longitude[, height] }
 * geographic object. An explicit `srid` must agree with the coordinate shape
 * (7203/9157 cartesian, 4326/4979 WGS 84) — neode delegated this to the
 * driver's Point type check, we validate the SRID consistency up front.
 */
export const pointSchema: z.ZodType = z.custom(value => {
    if (neo4j.isPoint(value)) {
        // driver v6 types Point.srid as Integer but stores a plain number
        return POINT_SRIDS.includes((value as unknown as { srid: number }).srid);
    }

    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const { x, y, z, latitude, longitude, height, srid } = value as Record<string, unknown>;

    // Cartesian coordinates
    if (x !== undefined || y !== undefined || z !== undefined) {
        if (latitude !== undefined || longitude !== undefined || height !== undefined) {
            return false;
        }

        if (!isCoordinate(x) || !isCoordinate(y) || (z !== undefined && !isCoordinate(z))) {
            return false;
        }

        if (srid === undefined) {
            return true;
        }

        return srid === (z === undefined ? SRID.CARTESIAN_2D : SRID.CARTESIAN_3D);
    }

    // WGS 84 (geographic) coordinates
    if (latitude !== undefined || longitude !== undefined || height !== undefined) {
        if (!isCoordinate(latitude) || !isCoordinate(longitude)) {
            return false;
        }

        if (height !== undefined && !isCoordinate(height)) {
            return false;
        }

        if (srid === undefined) {
            return true;
        }

        return srid === (height === undefined ? SRID.WGS_84_2D : SRID.WGS_84_3D);
    }

    return false;
}, { message: 'Expected a Neo4j point ({ x, y[, z] } or { latitude, longitude[, height] } with a consistent SRID, or a driver Point)' });

/**
 * A duration is valid when it is a driver Duration instance or a plain
 * object of non-negative integer components (neode never validated
 * durations — they were stored as strings).
 */
export const durationSchema: z.ZodType = z.custom(value => {
    if (neo4j.isDuration(value)) {
        return true;
    }

    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const { months = 0, days = 0, seconds = 0, nanoseconds = 0 } = value as Record<string, unknown>;

    return [ months, days, seconds, nanoseconds ].every(
        component => typeof component === 'number' && Number.isInteger(component) && component >= 0
    );
}, { message: 'Expected a Neo4j duration ({ months, days, seconds, nanoseconds } or a driver Duration)' });
