import { Newable } from "../../meta/newable";
import { mergeProperty, mergeRelationshipModel } from "../../meta"
import { PropertyType } from "../../meta/property-schema"

export default function StartNode(entity: () => Newable) {
    return function(target: any, propertyKey: string, _descriptor?: any): void {
        const constructor = target.constructor

        mergeRelationshipModel(constructor)

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.START_NODE)

        property.setEntity(entity())
    }
}
