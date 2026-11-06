import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type PropertyConfig from '../property-config.interface.js'

export default function Primary(config: PropertyConfig = {}) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    // Merge Property Key
    const property = mergeProperty(constructor, propertyKey, PropertyType.ANY, config)

    property.setPrimaryKey()
  }
}
