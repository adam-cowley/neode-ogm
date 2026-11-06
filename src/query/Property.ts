/**
 * A property in a SET clause: `property operator $param`
 * or, inline in a pattern, `property: $param`.
 */
export default class Property {
  private readonly param: string

  constructor(
    private readonly key: string,
    param: string,
    private readonly operator: string = '=',
  ) {
    this.param = `$${param}`
  }

  toString(): string {
    return `${this.key} ${this.operator} ${this.param}`.trim()
  }

  toInlineString(): string {
    return `${this.key}: ${this.param}`.trim()
  }
}
