import { mergeProperty, mergeRelationshipModel } from "../../meta"
import { PropertyType } from "../../meta/property-schema"
import 'reflect-metadata'

export default function OtherNode(entity: () => ObjectConstructor) {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        mergeRelationshipModel(constructor)

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.OTHER_NODE)

        property.setEntity(entity())
    }
}