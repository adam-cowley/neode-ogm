/**
 * Direction of a relationship pattern.
 *
 * Accepts the legacy case-insensitive 'IN' / 'OUT' / 'BOTH' spellings
 * anywhere a direction is taken.
 */
export enum Direction {
  INCOMING = 'INCOMING',
  OUTGOING = 'OUTGOING',
  BOTH = 'BOTH',
}

/**
 * Normalise a direction given in any supported spelling to a Direction.
 * Unknown values fall back to BOTH (the most permissive direction),
 * matching neode's behaviour of never throwing on a bad direction.
 */
export function toDirection(value: string | Direction | undefined | null): Direction {
  if (!value) {
    return Direction.BOTH
  }

  switch (String(value).toUpperCase()) {
    case Direction.INCOMING:
    case 'IN':
      return Direction.INCOMING

    case Direction.OUTGOING:
    case 'OUT':
      return Direction.OUTGOING

    default:
      return Direction.BOTH
  }
}
