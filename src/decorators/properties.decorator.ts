import { mergeProperty } from '../meta/index.js'
import { PropertyType } from '../meta/property-schema.js'
import type { Newable } from '../meta/newable.js'

export function Properties(): (target: { constructor: Newable }, propertyKey: string) => void {
  return function (target: { constructor: Newable }, propertyKey: string): void {
    const constructor = target.constructor

    // Merge Property Key
    mergeProperty(constructor, propertyKey, PropertyType.ALL_PROPERTIES)
  }
}
