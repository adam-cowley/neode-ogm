import { mergeProperty, mergeRelationshipModel } from "../../meta"
import { PropertyType } from "../../meta/property-schema"

export default function StartNode(entity: () => ObjectConstructor) {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        mergeRelationshipModel(constructor)

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.START_NODE)

        property.setEntity(entity())
    }
}
