import { Direction } from "@neode/querybuilder"
import { mergeRelationshipProperty } from "../../meta"

export default function OneToMany(entity: () => ObjectConstructor, type?: string, direction?: Direction, eager?: boolean) {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        // Merge Property Key
        mergeRelationshipProperty(
            constructor,
            propertyKey,
            type,
            entity(),
            direction,
            true,
            eager
        )
    }
}