import Match from './Match'
import Order from './Order'
import Property from './Property'
import Relationship from './Relationship'

export type SetClause = Property | string

export default class Statement {
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

  constructor(private readonly prefix: string = 'MATCH') {}

  match(match: Match | Relationship): Statement {
    this.pattern.push(match)

    return this
  }

  where(where: string): Statement {
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

  delete(...values: string[]): Statement {
    this.deleteValues.push(...values)

    return this
  }

  detachDelete(...values: string[]): Statement {
    this.detachDeleteValues.push(...values)

    return this
  }

  return(...values: string[]): Statement {
    this.returnValues.push(...values)

    return this
  }

  set(key: string, value: string, operator: string = '='): Statement {
    this.setValues.push(new Property(key, value, operator))

    return this
  }

  setRaw(items: SetClause[]): Statement {
    this.setValues.push(...items)

    return this
  }

  onCreateSet(key: string, value: string, operator: string = '='): Statement {
    this.onCreateSetValues.push(new Property(key, value, operator))

    return this
  }

  onMatchSet(key: string, value: string, operator: string = '='): Statement {
    this.onMatchSetValues.push(new Property(key, value, operator))

    return this
  }

  remove(items: string[]): Statement {
    this.removeValues.push(...items)

    return this
  }

  toString(includePrefix = true): string {
    const output: string[] = []

    if (this.pattern.length) {
      const pattern = this.pattern.map((pattern) => pattern.toString()).join('')

      if (includePrefix) {
        output.push(`${this.prefix} ${pattern}`)
      } else {
        output.push(pattern)
      }
    }

    if (this.whereClauses.length) {
      output.push(this.whereClauses.join(''))
    }

    if (this.removeValues.length) {
      output.push(`REMOVE ${this.removeValues.join(', ')}`)
    }

    if (this.onCreateSetValues.length) {
      output.push(
        `ON CREATE SET ${this.onCreateSetValues.map((value) => value.toString()).join(', ')}`,
      )
    }

    if (this.onMatchSetValues.length) {
      output.push(
        `ON MATCH SET ${this.onMatchSetValues.map((value) => value.toString()).join(', ')}`,
      )
    }

    if (this.setValues.length) {
      output.push(`SET ${this.setValues.map((value) => value.toString()).join(', ')}`)
    }

    if (this.deleteValues.length) {
      output.push(`DELETE ${this.deleteValues.join(', ')}`)
    }

    if (this.detachDeleteValues.length) {
      output.push(`DETACH DELETE ${this.detachDeleteValues.join(', ')}`)
    }

    if (this.returnValues.length) {
      output.push(`RETURN ${this.returnValues.join(', ')}`)
    }

    if (this.orderClauses.length) {
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
