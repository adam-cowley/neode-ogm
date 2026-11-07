import type { Newable } from '../../meta/newable.js'
import { mergeModel } from '../../meta/index.js'
import type { NodeConfig } from '../node-config.interface.js'
import { getRegistrations } from '../registrations.js'

export function NodeEntity(config: NodeConfig = {}): (constructor: Newable, context: ClassDecoratorContext) => void {
  return function (constructor: Newable, context: ClassDecoratorContext): void {
    // Replay field registrations queued by property/relationship decorators.
    // Read the metadata object from the decorator context: esbuild attaches
    // it to the class only AFTER the class decorator runs, so a Symbol
    // lookup on the constructor sees nothing yet.
    for (const registration of getRegistrations(context.metadata)) {
      registration(constructor)
    }

    // Merge Model into map
    const model = mergeModel(constructor)

    // If no label has been defined, use the constructor name
    const labels = config.labels || [constructor.name]

    // Sort Labels by name
    labels.sort()

    // Set Labels in definition
    model.setLabels(labels)

    // Agent-facing model explanation (NTS-445)
    if (config.description !== undefined) {
      model.setDescription(config.description)
    }
  }
}
