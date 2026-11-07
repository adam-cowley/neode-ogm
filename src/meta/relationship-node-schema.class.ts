export const NodePosition = {
  START: 'start',
  END: 'end',
  OTHER: 'other',
} as const

export type NodePosition = (typeof NodePosition)[keyof typeof NodePosition]

export class RelationshipNodeSchema {
  private readonly target: object
  private readonly position: NodePosition

  constructor(target: object, position: NodePosition) {
    this.target = target
    this.position = position
  }

  getTarget(): object {
    return this.target
  }

  getPosition(): NodePosition {
    return this.position
  }
}
