import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type PropertyConfig from '../property-config.interface.js'

/**
Register a boolean property.
*/
export default function Boolean(config: PropertyConfig = {}) {
  return function (target: unknown, propertyKey: string, _descriptor?: unknown): void {
    const constructor = (target as { constructor: object }).constructor

    mergeProperty(constructor, propertyKey, PropertyType.BOOLEAN, config)
  }
}
