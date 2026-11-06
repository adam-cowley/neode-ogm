import { randomUUID } from 'crypto'
import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'
import PropertyConfig from '../property-config.interface'

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
