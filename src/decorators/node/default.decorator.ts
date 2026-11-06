import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'
import { DefaultValue } from '../../meta/property-schema'

/**
 * Set a default value (literal or factory function) for the property.
 * Merges onto the existing property, so it can be stacked with a type decorator.
 */
export default function Default(value: DefaultValue) {
  return function (target: unknown, propertyKey: string, _descriptor?: unknown): void {
    const constructor = (target as { constructor: object }).constructor

    mergeProperty(constructor, propertyKey, PropertyType.ANY, { default: value })
  }
}
