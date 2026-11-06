import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'

/**
 * Hide the property from the returned model.
 * Merges onto the existing property, so it can be stacked with a type decorator.
 */
export default function Hidden() {
  return function (target: unknown, propertyKey: string, _descriptor?: unknown): void {
    const constructor = (target as { constructor: object }).constructor

    mergeProperty(constructor, propertyKey, PropertyType.ANY, { hidden: true })
  }
}
