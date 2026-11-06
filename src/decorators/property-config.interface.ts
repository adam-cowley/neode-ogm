import { DefaultValue } from '../meta/property-schema'

export default interface PropertyConfig {
  /** Property type name, as accepted by the @Property decorator (e.g. 'string', 'datetime'). */
  type?: string
  array?: boolean
  default?: DefaultValue
  primary?: boolean
  /**
   * boolean: single-property unique constraint.
   * string[]: composite unique covering exactly the listed properties
   * (NTS-140) — declared on one property, the array is the full composite.
   */
  unique?: boolean | string[]
  onCreateSet?: boolean
  onMatchSet?: boolean
  alwaysSet?: boolean
  required?: boolean
  hidden?: boolean
  protected?: boolean
  readonly?: boolean
  /**
   * boolean: single-property index.
   * string[]: composite index covering exactly the listed properties (NTS-140).
   */
  index?: boolean | string[]
  exists?: boolean
  /** Opt in to a property-type constraint generated from the declared type (NTS-141): `REQUIRE n.prop IS :: STRING`. */
  typed?: boolean
  /**
   * Read-side fallbacks applied at hydration when the stored/projected
   * value is null or absent (NTS-139, the Zod `.catch()` analogue): a
   * literal, or sibling property names whose first non-null value wins.
   */
  coalesce?: string | string[]

  /** neode validation rules (min, max, email, regex, …) — persisted as-is */
  [rule: string]: unknown
}
