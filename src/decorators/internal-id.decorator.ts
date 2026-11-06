import { mergeProperty } from '../meta'
import { PropertyType } from '../meta/property-schema'

export default function InternalId() {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    // Merge Property Key
    mergeProperty(constructor, propertyKey, PropertyType.INTERNAL_ID)
  }
}
