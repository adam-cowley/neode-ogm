import { randomUUID } from 'crypto';
import { mergeProperty } from '../../meta'
import { PropertyType } from '../../meta/property-schema'
import PropertyConfig from '../property-config.interface'

export default function Uuid(config: PropertyConfig = {}) {
    return function(target: unknown, propertyKey: string, _descriptor?: unknown): void {
        const constructor = (target as { constructor: object }).constructor

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.UUID, config)

        // Set Default
        property.setDefaultValue(() => randomUUID())
    }
}
