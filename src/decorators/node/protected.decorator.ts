import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'

/**
 * Mark the property as protected (never returned to the client).
 * Merges onto the existing property, so it can be stacked with a type decorator.
 */
export default function Protected() {
    return function(target: unknown, propertyKey: string, _descriptor?: unknown): void {
        const constructor = (target as { constructor: object }).constructor

        mergeProperty(constructor, propertyKey, PropertyType.ANY, { protected: true })
    }
}
