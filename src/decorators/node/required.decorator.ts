import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'

/**
 * Mark the property as required.
 * Merges onto the existing property, so it can be stacked with a type decorator.
 */
export default function Required() {
  return function (target: unknown, propertyKey: string, _descriptor?: unknown): void {
    const constructor = (target as { constructor: object }).constructor

    mergeProperty(constructor, propertyKey, PropertyType.ANY, { required: true })
  }
}
