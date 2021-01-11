import { mergeProperty, mergeRelationshipModel } from "../../meta"
import { PropertyType } from "../../meta/property-schema"

export default function EndNode(entity: () => ObjectConstructor) {
    return function(target: any, propertyKey: string): void {
        const constructor = target.constructor

        mergeRelationshipModel(constructor)

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.END_NODE)

        property.setEntity(entity())
    }
}
