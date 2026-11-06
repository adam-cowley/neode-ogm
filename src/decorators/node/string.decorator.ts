import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'
import PropertyConfig from '../property-config.interface'

/**
 * Register a string property.
 *
 * @deprecated Use `@Property({ type: 'string' })` instead — `@String` shadows the global `String` type.
 */
export default function String(config?: PropertyConfig) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    // Merge Property Key
    mergeProperty(constructor, propertyKey, PropertyType.STRING, config)
  }
}
