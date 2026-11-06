import { mergeRelationshipProperty } from '../../meta/index.js'
import type RelationshipConfig from '../relationship-config.interface.js'

export default function OneToOne(config: RelationshipConfig) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    // An explicit target() overrides design:type, which SWC cannot emit for
    // self-referential property types (it falls back to Object)
    const entity = config.target?.() ?? Reflect.getMetadata('design:type', target, propertyKey)

    // Merge Property Key
    mergeRelationshipProperty(
      constructor,
      propertyKey,
      config.type,
      entity,
      config.direction,
      false,
      config.eager,
    )
  }
}
