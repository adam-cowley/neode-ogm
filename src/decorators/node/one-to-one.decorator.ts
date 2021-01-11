import { mergeRelationshipProperty } from "../../meta"
import RelationshipConfig from "../relationship-config.interface"

export default function OneToOne(config: RelationshipConfig) {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        const entity = Reflect.getMetadata("design:type", target, propertyKey)

        // Merge Property Key
        mergeRelationshipProperty(
            constructor,
            propertyKey,
            config.type,
            entity,
            config.direction,
            false,
            config.eager
        )
    }
}