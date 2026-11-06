import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type PropertyConfig from '../property-config.interface.js'

/**
Register a local time property.
*/
export default function LocalTime(config: PropertyConfig = {}) {
  return function (target: unknown, propertyKey: string, _descriptor?: unknown): void {
    const constructor = (target as { constructor: object }).constructor

    mergeProperty(constructor, propertyKey, PropertyType.LOCALTIME, config)
  }
}
