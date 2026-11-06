import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type PropertyConfig from '../property-config.interface.js'

/**
Register a numeric (integer or float) property.
*/
export default function Number(config: PropertyConfig = {}) {
  return function (target: unknown, propertyKey: string, _descriptor?: unknown): void {
    const constructor = (target as { constructor: object }).constructor

    // NUMBER (int/integer are the INTEGER spellings, see @Property and the map API)
    mergeProperty(constructor, propertyKey, PropertyType.NUMBER, config)
  }
}
