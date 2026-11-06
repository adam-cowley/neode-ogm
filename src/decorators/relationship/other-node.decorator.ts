import type { Newable } from '../../meta/newable.js'
import { mergeProperty, mergeRelationshipModel } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import 'reflect-metadata'

export default function OtherNode(entity: () => Newable) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    mergeRelationshipModel(constructor)

    // Merge Property Key
    const property = mergeProperty(constructor, propertyKey, PropertyType.OTHER_NODE)

    property.setEntity(entity())
  }
}
