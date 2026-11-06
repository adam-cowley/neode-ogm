import { randomUUID } from 'crypto';

import { mergeModel, mergeProperty, mergeRelationshipProperty } from './index';
import { Newable } from './newable';
import PropertySchema, { PropertyType } from './property-schema';
import { toDirection } from '../query';
import {
    PropertyDefinition,
    PropertyTypeName,
    RelationshipDefinition,
    SchemaDefinition,
} from './schema-definition.interface';

/** neode's Model.js RELATIONSHIP_TYPES — keys that define a relationship */
const RELATIONSHIP_TYPES = [ 'relationship', 'relationships', 'node', 'nodes' ];

const PROPERTY_TYPES: Record<PropertyTypeName, PropertyType> = {
    any: PropertyType.ANY,
    string: PropertyType.STRING,
    number: PropertyType.NUMBER,
    int: PropertyType.INTEGER,
    integer: PropertyType.INTEGER,
    float: PropertyType.FLOAT,
    boolean: PropertyType.BOOLEAN,
    uuid: PropertyType.UUID,
    date: PropertyType.DATE,
    time: PropertyType.TIME,
    datetime: PropertyType.DATETIME,
    localtime: PropertyType.LOCALTIME,
    localdatetime: PropertyType.LOCALDATETIME,
    point: PropertyType.POINT,
    duration: PropertyType.DURATION,
};

/** Name index over the shared models registry */
const modelsByName: Map<string, Newable> = new Map();

/** Name index of the original definitions, kept for extendModel cloning */
const definitionsByName: Map<string, SchemaDefinition> = new Map();

/** Relationship definitions whose target model was not yet defined */
interface PendingRelationship {
    constructor: Newable;
    key: string;
    definition: RelationshipDefinition;
}

const pendingRelationships: PendingRelationship[] = [];

/**
 * A virtual entity class for map-defined models. Instances hydrate and
 * resolve back through the shared registry like decorator-defined classes
 * (`new constructor()` → `.constructor` finds the EntitySchema).
 */
function virtualConstructor(name: string): Newable {
    class Virtual {}

    Object.defineProperty(Virtual, 'name', { value: name });

    return Virtual;
}

function isRelationshipDefinition(value: unknown): value is RelationshipDefinition {
    return (
        typeof value === 'object' && value !== null &&
        RELATIONSHIP_TYPES.includes((value as RelationshipDefinition).type)
    );
}

function definePropertyModel(
    constructor: Newable,
    key: string,
    definition: PropertyTypeName | PropertyDefinition
): PropertySchema {
    const full: PropertyDefinition = typeof definition === 'string'
        ? { type: definition }
        : definition;

    // uuid properties generate a uuid by default (parity with the @Uuid decorator)
    if (full.type === 'uuid' && !Object.hasOwn(full, 'default')) {
        return mergeProperty(constructor, key, PropertyType.UUID, {
            ...full,
            default: () => randomUUID(),
        });
    }

    return mergeProperty(constructor, key, PROPERTY_TYPES[full.type] ?? PropertyType.ANY, full);
}

function wireRelationshipModel(
    constructor: Newable,
    key: string,
    definition: RelationshipDefinition,
    target: Newable
): void {
    mergeRelationshipProperty(
        constructor,
        key,
        definition.relationship ?? key,
        target,
        toDirection(definition.direction),
        definition.type === 'relationships' || definition.type === 'nodes',
        definition.eager
    );
}

/**
 * Wire any queued relationship definitions whose target now exists.
 * Targets defined later (e.g. `with()` order) resolve on the next call
 * into this module; targets that never exist simply stay unwired.
 */
function flushPendingRelationships(): void {
    for (let i = pendingRelationships.length - 1; i >= 0; i--) {
        const pending = pendingRelationships[i];
        const target = modelsByName.get(pending.definition.target);

        if ( !target ) {
            continue;
        }

        pendingRelationships.splice(i, 1);

        wireRelationshipModel(pending.constructor, pending.key, pending.definition, target);
    }
}

/**
 * Register a model from a map-based schema definition (neode parity),
 * returning the generated virtual class for the model.
 */
export function defineModel(name: string, schema: SchemaDefinition): Newable {
    const constructor = virtualConstructor(name);

    const model = mergeModel(constructor);

    model.setLabels(schema.labels || [ name ]);

    // Every node carries an internal id (parity with neode Node._id / @InternalId)
    if ( !Object.hasOwn(schema, '_id') ) {
        mergeProperty(constructor, '_id', PropertyType.INTERNAL_ID);
    }

    modelsByName.set(name, constructor);
    definitionsByName.set(name, schema);

    Object.entries(schema).forEach(([key, value]) => {
        if ( key === 'labels' || value === undefined ) {
            return;
        }

        if ( isRelationshipDefinition(value) ) {
            pendingRelationships.push({ constructor, key, definition: value });
        }
        else {
            definePropertyModel(constructor, key, value as PropertyTypeName | PropertyDefinition);
        }
    });

    flushPendingRelationships();

    return constructor;
}

/**
 * Get a previously defined model constructor by name
 */
export function getModelByName(name: string): Newable | undefined {
    flushPendingRelationships();

    return modelsByName.get(name);
}

/**
 * Get all defined model constructors, keyed by name
 */
export function getModelsByName(): Map<string, Newable> {
    flushPendingRelationships();

    return new Map(modelsByName);
}

/**
 * neode's extend(): register `as` as a clone of the model `name` with `as`
 * added as an extra label and `schema` merged over the original definition.
 */
export function extendModel(name: string, as: string, schema: SchemaDefinition = {}): Newable {
    const original = definitionsByName.get(name);

    if ( !original ) {
        throw new Error(unknownDefinitionError(name));
    }

    return defineModel(as, {
        ...original,
        ...schema,
        labels: [ ...(original.labels || [ name ]), as ],
    });
}

/**
 * neode's helpful error message for a model lookup that found nothing
 */
export function unknownDefinitionError(name: string): string {
    const defined = Array.from(modelsByName.keys());

    let message = `Couldn't find a definition for "${name}".`;

    if ( !defined.length ) {
        message += ' It looks like no models have been defined.';
    }
    else {
        message += ` The models currently defined are [${ defined.join(', ') }]`;
    }

    return message;
}
