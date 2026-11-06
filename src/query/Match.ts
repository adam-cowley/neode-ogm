import Property from './Property'

export default class Match {
  constructor(
    private readonly alias?: string,
    private readonly labels: string | string[] | false = false,
    private readonly properties: Property[] = [],
  ) {}

  toString(): string {
    const alias = this.alias || ''

    let label: string = ''

    if (Array.isArray(this.labels)) {
      label = this.labels.length ? `:${this.labels.join(':')}` : ''
    } else if (typeof this.labels === 'string' && this.labels.length) {
      label = `:${this.labels}`
    }

    let properties = ''

    if (this.properties.length) {
      properties = ` { ${this.properties.map((property) => property.toInlineString()).join(', ')} }`
    }

    return `(${alias}${label}${properties})`
  }
}
