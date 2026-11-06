import { mergeProperty } from "../meta"
import { PropertyType } from "../meta/property-schema"
import PropertyConfig from "./property-config.interface"

const TYPE_ALIASES: Record<string, PropertyType> = {
    string: PropertyType.STRING,
    number: PropertyType.NUMBER,
    int: PropertyType.INTEGER,
    integer: PropertyType.INTEGER,
    float: PropertyType.FLOAT,
    boolean: PropertyType.BOOLEAN,
    uuid: PropertyType.UUID,
    date: PropertyType.DATE,
    time: PropertyType.TIME,
    datetime: PropertyType.DATETIME,
    localtime: PropertyType.LOCALTIME,
    localdatetime: PropertyType.LOCALDATETIME,
    point: PropertyType.POINT,
    duration: PropertyType.DURATION,
    any: PropertyType.ANY,
}

/**
 * Register a property with an explicit type and config, e.g.
 * `@Property({ type: 'string', index: true })`.
 *
 * Prefer this over `@String` to avoid shadowing global types.
 */
export default function Property(config: PropertyConfig = {}) {
    return function(target: unknown, propertyKey: string, _descriptor?: unknown): void {
        const constructor = (target as { constructor: object }).constructor

        let type = PropertyType.ANY

        if ( config.type !== undefined ) {
            const mapped: PropertyType | undefined = TYPE_ALIASES[config.type]

            if ( mapped === undefined ) {
                throw new Error(
                    `Unknown property type "${config.type}". Valid types: ${Object.keys(TYPE_ALIASES).join(', ')}`
                )
            }

            type = mapped
        }

        // Merge Property Key (config.type is not a PropertySchema option, mergeProperty ignores it)
        mergeProperty(constructor, propertyKey, type, config)
    }
}
