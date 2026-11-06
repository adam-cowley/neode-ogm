export default class WhereId {
  private negative = false

  constructor(
    private readonly alias: string,
    private readonly param: string,
  ) {}

  setNegative(): void {
    this.negative = true
  }

  toString(): string {
    const prefix = this.negative ? 'NOT ' : ''

    return `${prefix}elementId(${this.alias}) = $${this.param}`
  }
}
