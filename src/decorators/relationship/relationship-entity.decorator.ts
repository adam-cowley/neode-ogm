import type { Newable } from '../../meta/newable.js'
import { mergeRelationshipModel } from '../../meta/index.js'

export default function RelationshipEntity() {
  return function (constructor: Newable) {
    // Merge Model into map or update the type to relationship
    mergeRelationshipModel(constructor)
  }
}
