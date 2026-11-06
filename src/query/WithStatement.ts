export default class WithStatement {
  constructor(private readonly variables: string[]) {}

  toString(): string {
    return `WITH ${this.variables.join(', ')}`
  }
}
