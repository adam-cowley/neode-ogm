import { mergeProperty } from "../../meta"
import { PropertyType } from "../../meta/property-schema"

export default function Unique() {
    return function(target: any, propertyKey: string, _descriptor?: any): void {
        const constructor = target.constructor

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.ANY)

        property.setUnique()
    }
}