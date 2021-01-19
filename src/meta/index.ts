import { Direction } from "@neode/querybuilder";
import PropertySchema, { PropertyType } from "./property-schema";

import RelationshipPropertySchema from "./relationship-property-schema";

import EntitySchema, { EntityType } from "./entity/entity-schema";
import PropertyConfig from "../decorators/property-config.interface";
import Repository from "../repository/index";

const models: Map<ObjectConstructor, EntitySchema> = new Map()

export function getModels() {
    return models
}

export function getModel(constructor: any): EntitySchema {
    return getModels().get(constructor)
}

export function mergeModel(constructor: any): EntitySchema {
    if ( !getModels().has(constructor) ) {
        getModels().set(constructor, new EntitySchema())
    }

    return getModels().get(constructor)
}

export function mergeRelationshipModel(constructor: any): EntitySchema {
    // Decorators are run in a weird order (accessor, property then class decorators)
    // So this may already exist as a NodeEntity and should be confirmed
    if ( !getModels().has(constructor) ) {
        getModels().set(constructor, new EntitySchema())
    }

    const model = getModels().get(constructor)
    model.setType(EntityType.RelationshipEntity)

    return model
}

export function mergeProperty(constructor: any, key: string, type: PropertyType, config: PropertyConfig = {}): PropertySchema {
    const model = mergeModel(constructor)

    if ( !model.hasProperty(key) ) {
        model.addProperty(key)
    }

    const property = model.getProperty(key) as PropertySchema

    // If specificially set, then overwrite the type
    if ( type !== PropertyType.ANY ) {
        property.setType(type)
    }

    // Set Config
    if ( config?.primary === true ) {
        property.setPrimaryKey(true)
    }

    if ( config?.unique === true ) {
        property.setUnique(true)
    }

    if ( config?.array === true ) {
        property.setArray(true)
    }

    if ( config?.hasOwnProperty('default') ) {
        property.setDefaultValue(config.default)
    }

    if ( config?.hasOwnProperty('onCreateSet') ) {
        property.setOnCreateSet(config.onCreateSet)
    }

    if ( config?.hasOwnProperty('onMatchSet') ) {
        property.setOnMatchSet(config.onMatchSet)
    }

    if ( config?.hasOwnProperty('alwaysSet') ) {
        property.setAlwaysSet(config.alwaysSet)
    }

    return property
}

export function mergeRelationshipProperty(constructor: any, key: string,
    type: string,
    target: ObjectConstructor,
    direction: Direction,
    many: boolean,
    eager?: boolean
): RelationshipPropertySchema {
    mergeModel(constructor)

    if ( !models.get(constructor).hasProperty(key) ) {
        models.get(constructor).addRelationship(key)
    }

    const rel = models.get(constructor).getRelationship(key)

    rel.setType(type)
    rel.setDirection(direction)
    rel.setTarget(target)
    rel.setMany(many)
    rel.setEager(eager || false)

    return rel
}

const repositories: Map<ObjectConstructor, Repository<any>> = new Map()

export function registerRepository(entity: ObjectConstructor, repository: Repository<any>) {
    repositories.set(entity, repository)
}

export function getRepository<T extends ObjectConstructor>(entity: T): Repository<T> | undefined {
    return repositories.get(entity)
}
