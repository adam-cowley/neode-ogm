export default class Order {
  constructor(
    private readonly field: string,
    private readonly direction: string = '',
  ) {}

  toString(): string {
    return `${this.field} ${this.direction}`.trim()
  }
}
