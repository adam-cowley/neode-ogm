import { Property, PropertyType } from "./property";
import Schema from "./schema";

export const models: Map<Object, Schema> = new Map()

export function mergeModel(constructor: any): Schema {
    if ( !models.has(constructor) ) {
        models.set(constructor, new Schema())
    }

    return models.get(constructor)
}

export function mergeProperty(constructor: any, key: string, type: PropertyType): Property {
    if ( !models.has(constructor) ) {
        models.set(constructor, new Schema())
    }

    if ( ! models.get(constructor).hasProperty(key) ) {
        models.get(constructor).addProperty(key)
    }

    return models.get(constructor).getProperty(key)
}