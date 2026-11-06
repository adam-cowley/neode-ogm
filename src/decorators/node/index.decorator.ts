import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'

/**
Mark the property as indexed.
Merges onto the existing property, so it can be stacked with a type decorator.
*/
export default function Index() {
  return function (target: unknown, propertyKey: string, _descriptor?: unknown): void {
    const constructor = (target as { constructor: object }).constructor

    mergeProperty(constructor, propertyKey, PropertyType.ANY, { index: true })
  }
}
