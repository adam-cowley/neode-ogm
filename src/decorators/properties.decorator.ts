import { mergeProperty } from "../meta"
import { PropertyType } from "../meta/property-schema"


export default function Properties() {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        // Merge Property Key
        mergeProperty(constructor, propertyKey, PropertyType.ALL_PROPERTIES)
    }
}