import { mergeProperty } from '../../meta';
import { PropertyType } from '../../meta/property-schema';
import { toDirection } from '../../query';
import { RelationshipExistsConfig } from './projection-config.interface';

/**
 * NTS-137 — relationship existence projected as an inline `EXISTS { }`
 * boolean in the read query. `where` uses `node` as the variable convention
 * for the target node.
 *
 * Example:
 * ```ts
 * @RelationshipExists({ type: 'NEXT_LESSON', direction: 'out' })
 * hasNextLesson: boolean;
 * ```
 */
export default function RelationshipExists(config: RelationshipExistsConfig) {
    return function(target: any, propertyKey: string, _descriptor?: any): void {
        const constructor = target.constructor

        const property = mergeProperty(
            constructor,
            propertyKey,
            PropertyType.RELATIONSHIP_EXISTS,
            { where: config.where }
        );

        property.setRelationshipType(config.type)
        property.setDirection(toDirection(config.direction))
    }
}
