import { randomUUID } from 'node:crypto'
import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type PropertyConfig from '../property-config.interface.js'

export default function Uuid(config: PropertyConfig = {}) {
  return function (target: unknown, propertyKey: string, _descriptor?: unknown): void {
    const constructor = (target as { constructor: object }).constructor

    const property = mergeProperty(constructor, propertyKey, PropertyType.UUID, config)

    // An explicit config default wins (parity with the map API's uuid handling)
    if (!Object.hasOwn(config, 'default')) {
      property.setDefaultValue(() => randomUUID())
    }
  }
}
