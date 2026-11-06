import { Direction, toDirection } from './Direction.js'

export default class Relationship {
  private readonly direction: Direction
  private readonly type: string | string[] | undefined
  private readonly alias: string | undefined
  private readonly traversals: number | string | undefined

  constructor(
    type: string | string[] | undefined,
    direction: string | Direction | undefined,
    alias?: string,
    traversals?: number | string,
  ) {
    this.type = type
    this.alias = alias
    this.traversals = traversals
    this.direction = toDirection(direction)
  }

  toString(): string {
    const dirIn = this.direction === Direction.INCOMING ? '<' : ''
    const dirOut = this.direction === Direction.OUTGOING ? '>' : ''
    const alias = this.alias ? this.alias : ''

    let type: string = Array.isArray(this.type) ? this.type.join('`|`') : this.type || ''

    if (type !== '') {
      type = `:\`${type}\``
    }

    const traversals = this.traversals === undefined ? '' : `*${this.traversals}`

    const pattern =
      this.type || this.alias || this.traversals !== undefined
        ? `[${alias}${type}${traversals}]`
        : ''

    return `${dirIn}-${pattern}-${dirOut}`
  }
}
