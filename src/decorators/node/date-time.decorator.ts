import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'
import PropertyConfig from '../property-config.interface'

/**
 * Register a datetime property.
 */
export default function DateTime(config: PropertyConfig = {}) {
    return function(target: unknown, propertyKey: string, _descriptor?: unknown): void {
        const constructor = (target as { constructor: object }).constructor

        mergeProperty(constructor, propertyKey, PropertyType.DATETIME, config)
    }
}
