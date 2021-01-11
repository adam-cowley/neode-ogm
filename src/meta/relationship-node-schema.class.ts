export enum NodePosition {
    START = 'start',
    END = 'end',
    OTHER = 'other'
}

export default class RelationshipNodeSchema {
    constructor(
        private readonly target: Object,
        private readonly position: NodePosition
    ) {}

    getTarget() {
        return this.target
    }

    getPosition() {
        return this.position
    }
}