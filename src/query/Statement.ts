import type Match from './Match.js'
import type Order from './Order.js'
import Property from './Property.js'
import type Relationship from './Relationship.js'

export type SetClause = Property | string

export default class Statement {
  private readonly prefix: string = 'MATCH'
  private readonly pattern: (Match | Relationship)[] = []
  private readonly whereClauses: string[] = []
  private readonly orderClauses: Order[] = []
  private readonly detachDeleteValues: string[] = []
  private readonly deleteValues: string[] = []
  private readonly returnValues: string[] = []
  private readonly setValues: SetClause[] = []
  private readonly onCreateSetValues: SetClause[] = []
  private readonly onMatchSetValues: SetClause[] = []
  private readonly removeValues: string[] = []

  private limitValue?: number
  private skipValue?: number

  constructor(prefix = 'MATCH') {
    this.prefix = prefix
  }

  match(match: Match | Relationship): this {
    this.pattern.push(match)

    return this
  }

  where(where: string): this {
    this.whereClauses.push(where)

    return this
  }

  limit(limit: number): void {
    this.limitValue = limit
  }

  skip(skip: number): void {
    this.skipValue = skip
  }

  order(order: Order): void {
    this.orderClauses.push(order)
  }

  delete(...values: string[]): this {
    this.deleteValues.push(...values)

    return this
  }

  detachDelete(...values: string[]): this {
    this.detachDeleteValues.push(...values)

    return this
  }

  return(...values: string[]): this {
    this.returnValues.push(...values)

    return this
  }

  set(key: string, value: string, operator = '='): this {
    this.setValues.push(new Property(key, value, operator))

    return this
  }

  setRaw(items: SetClause[]): this {
    this.setValues.push(...items)

    return this
  }

  onCreateSet(key: string, value: string, operator = '='): this {
    this.onCreateSetValues.push(new Property(key, value, operator))

    return this
  }

  onMatchSet(key: string, value: string, operator = '='): this {
    this.onMatchSetValues.push(new Property(key, value, operator))

    return this
  }

  remove(items: string[]): this {
    this.removeValues.push(...items)

    return this
  }

  toString(includePrefix = true): string {
    const output: string[] = []

    if (this.pattern.length > 0) {
      const pattern = this.pattern.map((pattern) => pattern.toString()).join('')

      if (includePrefix) {
        output.push(`${this.prefix} ${pattern}`)
      } else {
        output.push(pattern)
      }
    }

    if (this.whereClauses.length > 0) {
      output.push(this.whereClauses.join(''))
    }

    if (this.removeValues.length > 0) {
      output.push(`REMOVE ${this.removeValues.join(', ')}`)
    }

    if (this.onCreateSetValues.length > 0) {
      output.push(
        `ON CREATE SET ${this.onCreateSetValues.map((value) => value.toString()).join(', ')}`,
      )
    }

    if (this.onMatchSetValues.length > 0) {
      output.push(
        `ON MATCH SET ${this.onMatchSetValues.map((value) => value.toString()).join(', ')}`,
      )
    }

    if (this.setValues.length > 0) {
      output.push(`SET ${this.setValues.map((value) => value.toString()).join(', ')}`)
    }

    if (this.deleteValues.length > 0) {
      output.push(`DELETE ${this.deleteValues.join(', ')}`)
    }

    if (this.detachDeleteValues.length > 0) {
      output.push(`DETACH DELETE ${this.detachDeleteValues.join(', ')}`)
    }

    if (this.returnValues.length > 0) {
      output.push(`RETURN ${this.returnValues.join(', ')}`)
    }

    if (this.orderClauses.length > 0) {
      output.push(`ORDER BY ${this.orderClauses.map((order) => order.toString()).join(', ')}`)
    }

    if (this.skipValue !== undefined) {
      output.push(`SKIP ${this.skipValue}`)
    }

    if (this.limitValue !== undefined) {
      output.push(`LIMIT ${this.limitValue}`)
    }

    return output.filter((line) => line && line.length).join('\n')
  }
}
