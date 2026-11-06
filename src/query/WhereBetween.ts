export default class WhereBetween {
  private negative = false

  constructor(
    private readonly alias: string,
    private readonly floor: string,
    private readonly ceiling: string,
  ) {}

  setNegative(): void {
    this.negative = true
  }

  toString(): string {
    const prefix = this.negative ? 'NOT ' : ''

    return `${prefix}$${this.floor} <= ${this.alias} <= $${this.ceiling}`
  }
}
