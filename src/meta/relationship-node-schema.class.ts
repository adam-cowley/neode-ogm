export const NodePosition = {
  START: 'start',
  END: 'end',
  OTHER: 'other',
} as const

export type NodePosition = (typeof NodePosition)[keyof typeof NodePosition]

export default class RelationshipNodeSchema {
  private readonly target: object
  private readonly position: NodePosition

  constructor(target: object, position: NodePosition) {
    this.target = target
    this.position = position
  }

  getTarget() {
    return this.target
  }

  getPosition() {
    return this.position
  }
}
