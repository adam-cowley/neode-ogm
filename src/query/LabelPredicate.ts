/**
 * A label predicate: `alias:Label` (several labels require all of them),
 * shared by `whereLabel` (`WHERE n:Completed`) and `orderByLabel`
 * (`ORDER BY n:Completed DESC`).
 */
export default class LabelPredicate {
  private negative = false

  constructor(
    private readonly alias: string,
    private readonly labels: string | string[],
    negative = false,
  ) {
    this.negative = negative
  }

  setNegative(): void {
    this.negative = true
  }

  toString(): string {
    const labels = Array.isArray(this.labels) ? this.labels.join(':') : this.labels
    const prefix = this.negative ? 'NOT ' : ''

    return `${prefix}${this.alias}:${labels}`
  }
}
