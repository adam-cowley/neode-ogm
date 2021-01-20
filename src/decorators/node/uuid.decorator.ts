import { v4 } from 'uuid'
import { mergeProperty } from "../../meta"
import { PropertyType } from "../../meta/property-schema"
import PropertyConfig from "../property-config.interface"

export default function Uuid(config: PropertyConfig = {}) {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.UUID, config)

        // Set Default
        // TODO: Call the function
        property.setDefaultValue(() => v4())
    }
}