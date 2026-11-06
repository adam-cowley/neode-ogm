export default class WhereRaw {
    constructor(private readonly statement: string) {}

    toString(): string {
        return this.statement;
    }
}
