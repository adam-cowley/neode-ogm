import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'

export default function Unique() {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    // Merge Property Key
    const property = mergeProperty(constructor, propertyKey, PropertyType.ANY)

    property.setUnique()
  }
}
