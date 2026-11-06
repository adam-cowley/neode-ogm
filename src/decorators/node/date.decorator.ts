import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'
import PropertyConfig from '../property-config.interface'

/**
 * Register a date property.
 */
export default function Date(config: PropertyConfig = {}) {
    return function(target: unknown, propertyKey: string, _descriptor?: unknown): void {
        const constructor = (target as { constructor: object }).constructor

        mergeProperty(constructor, propertyKey, PropertyType.DATE, config)
    }
}
