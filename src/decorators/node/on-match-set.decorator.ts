import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'

/**
 * Mark the property as set on match.
 * Merges onto the existing property, so it can be stacked with a type decorator.
 */
export default function OnMatchSet() {
    return function(target: unknown, propertyKey: string, _descriptor?: unknown): void {
        const constructor = (target as { constructor: object }).constructor

        mergeProperty(constructor, propertyKey, PropertyType.ANY, { onMatchSet: true })
    }
}
