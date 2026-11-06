import type { Newable } from '../../meta/newable.js'
import { mergeRelationshipModel } from '../../meta/index.js'
import { replayRegistrations } from '../registrations.js'

export default function RelationshipEntity() {
  return function (constructor: Newable, _context: ClassDecoratorContext): void {
    // Replay field registrations queued by property decorators
    replayRegistrations(constructor)

    // Merge Model into map or update the type to relationship
    mergeRelationshipModel(constructor)
  }
}
