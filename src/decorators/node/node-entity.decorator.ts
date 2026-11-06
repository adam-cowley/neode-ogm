import type { Newable } from '../../meta/newable.js'
import { mergeModel } from '../../meta/index.js'
import type NodeConfig from '../node-config.interface.js'

export default function NodeEntity(config: NodeConfig = {}) {
  return function (constructor: Newable) {
    // Merge Model into map
    const model = mergeModel(constructor)

    // If no label has been defined, use the constructor name
    const labels = config.labels || [constructor.name]

    // Sort Labels by name
    labels.sort()

    // Set Labels in definition
    model.setLabels(labels)
  }
}
