import type { Newable } from '../../meta/newable.js'
import { mergeProperty, mergeRelationshipModel } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'

export default function EndNode(entity: () => Newable) {
  return function (target: any, propertyKey: string): void {
    const constructor = target.constructor

    mergeRelationshipModel(constructor)

    // Merge Property Key
    const property = mergeProperty(constructor, propertyKey, PropertyType.END_NODE)

    property.setEntity(entity())
  }
}
