/**
 * Active-record style instance methods for hydrated entities (P7.2).
 *
 * Hydrated entities get `save()`, `update()`, `delete()`, `relateTo()` and
 * `detachFrom()` on their PROTOTYPE (wired once per entity constructor at
 * first hydration, see applyEntityMethods) so instances behave like neode's
 * Node without needing the Neode instance in scope.
 *
 * The methods need a Neode instance. Hydration has no access to the Neode
 * performing the query (QueryService hands it only schemas and classes), so
 * methods resolve a module-level default at call time. Set it explicitly
 * with setDefaultNeode(); the most recently set instance wins.
 */
import type Neode from './neode.service';
import type { Newable } from './meta/newable';
import type { DeleteOptions } from './services/query/delete.service';
import type { DetachResult } from './services/query/detach.service';
import type { GraphRelationship } from './driver/types';
import { getModel } from './meta';
import { PropertyType } from './meta/property-schema';
import { toJson } from './serialise';

/**
 * The Neode instance that entity instance methods operate against.
 *
 * shortcut: last-set-wins — multiple Neode instances cannot be addressed
 * from instance methods; upgrade by threading the instance through hydration.
 */
let defaultNeode: Neode | undefined;

/**
 * Set the Neode instance used by entity instance methods
 * (`person.save()`, `person.relateTo(...)`, ...).
 */
export function setDefaultNeode(neode: Neode): void {
    defaultNeode = neode;
}

function requireNeode(): Neode {
    if (!defaultNeode) {
        throw new Error(
            'No Neode instance available for entity instance methods — call setDefaultNeode(neode) first'
        );
    }

    return defaultNeode;
}

function constructorOf(entity: object): new (...args: never[]) => object {
    return (entity as { constructor: unknown }).constructor as new (...args: never[]) => object;
}

/**
 * The elementId of a hydrated entity (carried by its InternalId property)
 */
function elementIdOf(entity: object): string {
    const schema = getModel(constructorOf(entity));

    if (!schema) {
        throw new Error('Entity is not a registered model — cannot resolve its elementId');
    }

    const idKey = schema
        .getProperties()
        .find((property) => property.getType() === PropertyType.INTERNAL_ID)
        ?.getKey();

    const elementId = idKey ? (entity as Record<string, unknown>)[idKey] : undefined;

    if (!elementId) {
        throw new Error('Entity has no elementId — save() it before changing its labels');
    }

    return elementId as string;
}

/**
 * SET / REMOVE a label on the node matched by elementId (autocommit — labels
 * cannot be parameterised), then re-hydrate the entity in place
 */
async function changeLabel(entity: object, label: string, verb: 'SET' | 'REMOVE'): Promise<object> {
    const neode = requireNeode();
    const elementId = elementIdOf(entity);

    await neode.writeCypher(`MATCH (n) WHERE elementId(n) = $elementId ${verb} n:${label}`, {
        elementId,
    });

    const hydrated = await neode.findById(constructorOf(entity), elementId);

    if (hydrated) {
        Object.assign(entity, hydrated);
    }

    return entity;
}

/**
 * The methods wired onto hydrated entities. Uses polymorphic `this` so
 * `WithMethods<Person>` chains as `Promise<WithMethods<Person>>`.
 */
export interface EntityMethods {
    /** MERGE this entity, then re-hydrate the persisted state onto it */
    save(): Promise<this>;

    /** `+=` update the given properties, then re-hydrate onto this entity */
    update(properties?: Record<string, unknown>): Promise<this>;

    /**
     * Delete this node from the graph (cascade options as in neode.delete).
     * With `{ soft: label }` the label is SET instead and the refreshed
     * entity is returned; without it the node is deleted and the same
     * (detached) instance is returned.
     */
    delete(options?: DeleteOptions | string): Promise<this>;

    /** Add a label to this node's state (SET n:Label) and re-hydrate */
    addLabel(label: string): Promise<this>;

    /** Remove a label from this node's state (REMOVE n:Label) and re-hydrate */
    removeLabel(label: string): Promise<this>;

    /**
     * Relate this entity to another saved entity, resolving the
     * relationship by its key on this entity's schema
     */
    relateTo<To extends object>(
        other: To,
        relationshipKey: string,
        properties?: Record<string, unknown>,
        forceCreate?: boolean
    ): Promise<GraphRelationship | undefined>;

    /** Remove the relationship of the given key between this entity and other */
    detachFrom<To extends object>(other: To, relationshipKey: string): Promise<DetachResult<this, To>>;
}

/**
 * Type helper for entity instances: `WithMethods<Person>` adds the
 * instance methods to a user class. Runtime works on hydrated instances
 * regardless — this is only for type-checking, since declaration merging
 * onto arbitrary user classes is not possible.
 */
export type WithMethods<T extends object> = T & EntityMethods;

/**
 * The runtime implementations (this-typed, attached to the prototype)
 */
interface MethodImpl {
    save(this: object): Promise<object>;
    update(this: object, properties?: Record<string, unknown>): Promise<object>;
    delete(this: object, options?: DeleteOptions | string): Promise<object>;
    addLabel(this: object, label: string): Promise<object>;
    removeLabel(this: object, label: string): Promise<object>;
    toJson(this: object): Record<string, unknown>;
    relateTo(
        this: object,
        other: object,
        relationshipKey: string,
        properties?: Record<string, unknown>,
        forceCreate?: boolean
    ): Promise<GraphRelationship | undefined>;
    detachFrom(this: object, other: object, relationshipKey: string): Promise<DetachResult<object, object>>;
}

const methods: MethodImpl = {
    async save(this) {
        const saved = await requireNeode().save(this);

        return Object.assign(this, saved);
    },

    toJson(this) {
        return toJson(this);
    },

    async update(this, properties = {}) {
        const hydrated = await requireNeode().update(this, properties);

        if (hydrated) {
            Object.assign(this, hydrated);
        }

        return this;
    },

    async delete(this, options) {
        const soft = options && typeof options === 'object' ? (options as DeleteOptions).soft : undefined;

        // Labels-as-state: SET the soft-delete label instead of deleting,
        // returning the refreshed entity
        if (soft) {
            return changeLabel(this, soft, 'SET');
        }

        await requireNeode().delete(this, options);

        return this;
    },

    addLabel(this, label) {
        return changeLabel(this, label, 'SET');
    },

    removeLabel(this, label) {
        return changeLabel(this, label, 'REMOVE');
    },

    async relateTo(this, other, relationshipKey, properties = {}, forceCreate = false) {
        return requireNeode().relate(
            constructorOf(this),
            this,
            other,
            relationshipKey,
            properties,
            forceCreate
        );
    },

    async detachFrom(this, other, relationshipKey) {
        return requireNeode().detach(constructorOf(this), this, other, relationshipKey);
    },
};

const METHODS_APPLIED = Symbol('neode:entity-methods-applied');

/**
 * Wire the instance methods onto an entity class's PROTOTYPE (idempotent:
 * applied once per constructor, at first hydration or by explicit call).
 * Methods the user class already defines are left untouched.
 */
export function applyEntityMethods(constructor: Newable, neode?: Neode): void {
    if (neode) {
        setDefaultNeode(neode);
    }

    const proto = (constructor as unknown as { prototype: object }).prototype;

    if (Object.hasOwn(proto, METHODS_APPLIED)) {
        return;
    }

    for (const [name, fn] of Object.entries(methods)) {
        // A user-defined method wins — partial adoption, no clobbering
        if (name in proto) {
            continue;
        }

        Object.defineProperty(proto, name, {
            value: fn,
            enumerable: false,
            writable: true,
            configurable: true,
        });
    }

    Object.defineProperty(proto, METHODS_APPLIED, {
        value: true,
        enumerable: false,
    });
}
