import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'
import PropertyConfig from '../property-config.interface'

/**
 * Register a numeric (integer or float) property.
 */
export default function Number(config: PropertyConfig = {}) {
    return function(target: unknown, propertyKey: string, _descriptor?: unknown): void {
        const constructor = (target as { constructor: object }).constructor

        mergeProperty(constructor, propertyKey, PropertyType.INTEGER, config)
    }
}
