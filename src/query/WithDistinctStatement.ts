export default class WithDistinctStatement {
    constructor(private readonly variables: string[]) {}

    toString(): string {
        return `WITH DISTINCT ${this.variables.join(', ')}`;
    }
}
