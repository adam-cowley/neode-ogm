import { z } from 'zod'
import neo4j from 'neo4j-driver'

import PropertySchema, { PropertyType } from '../meta/property-schema'
import {
  anySchema,
  booleanSchema,
  dateSchema,
  datetimeSchema,
  durationSchema,
  floatSchema,
  integerSchema,
  localdatetimeSchema,
  localtimeSchema,
  numberSchema,
  pointSchema,
  stringSchema,
  timeSchema,
  uuidSchema,
} from './value-schemas'

/**
 * Rule table — ports neode's Joi rule names (src/Services/Validator.js) onto
 * Zod. Each property builds a Zod schema from its PropertyType base schema
 * plus the rule options present on it, exactly like neode's
 * BuildValidationSchema did with Joi.
 *
 * All rules are applied as refines/transforms on the base schema so they
 * compose with any base type and with each other, and so every failing check
 * is collected (zod runs all checks per value ≙ abortEarly: false).
 */

/** Which family a base schema belongs to — decides which rules can apply */
type RuleKind = 'string' | 'number' | 'boolean' | 'temporal' | 'point' | 'duration' | 'any'

interface BuildContext {
  key: string
  kind: RuleKind
  config: Record<string, unknown>
}

interface BuildState {
  insensitive: boolean
  allowValues: unknown[]
  truncated: boolean
}

/** Structural keys consumed by the metamodel, never rules (neode's ignore list) */
const IGNORED_KEYS = new Set([
  'labels',
  'type',
  'default',
  'alias',
  'properties',
  'primary',
  'relationship',
  'target',
  'direction',
  'eager',
  'hidden',
  'readonly',
  'index',
  'unique',
  'cascade',
  // neode-ogm metamodel keys
  'array',
  'protected',
  'exists',
  'onCreateSet',
  'onMatchSet',
  'alwaysSet',
])

/** Rules applied only when their option is exactly true (neode's `booleans`) */
const BOOLEAN_TRUE_RULES = new Set([
  'optional',
  'forbidden',
  'strip',
  'positive',
  'negative',
  'port',
  'integer',
  'iso',
  'isoDate',
  'insensitive',
  'required',
  'truncate',
  'creditCard',
  'alphanum',
  'token',
  'hostname',
  'lowercase',
  'uppercase',
  'truthy',
  'falsy',
])

/**
 * Rules applied with an options object, or with defaults when true, and
 * skipped when falsy (neode's `booleanOrOptions`)
 */
const BOOLEAN_OR_OPTIONS_RULES = new Set(['email', 'ip', 'uri', 'base64', 'normalize', 'hex'])

// Pre-built format checks — used inside refines so they compose with any base
const IS_EMAIL = z.email()
const IS_URL = z.url()
const IS_IPV4 = z.ipv4()
const IS_IPV6 = z.ipv6()
const IS_UUID = z.uuid()
const IS_UUID_V4 = z.uuidv4()
const IS_CREDIT_CARD = z.creditCard()
const ISO_DATE = z.iso.date()
const ISO_DATETIME = z.iso.datetime({ offset: true, local: true })

const HOSTNAME_PATTERN =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function failUnsupported(rule: string, key: string): never {
  throw new Error(`Not sure how to validate ${rule} on ${key}`)
}

function asNumber(value: unknown): number | null {
  if (neo4j.isInt(value)) return value.toNumber()

  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function matches(value: unknown, expected: unknown, insensitive: boolean): boolean {
  if (insensitive && typeof value === 'string' && typeof expected === 'string') {
    return value.toLowerCase() === expected.toLowerCase()
  }

  return value === expected
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value

  if (typeof value === 'number') return new Date(value)

  if (typeof value === 'string' || typeof value === 'object') {
    const date = new Date(String(value))

    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

function decimalPlaces(value: number): number {
  const parts = value.toString().split('.')

  return parts.length > 1 ? parts[1].length : 0
}

function numberRefine(
  schema: z.ZodType,
  message: string,
  predicate: (value: number) => boolean,
): z.ZodType {
  return schema.refine(
    (value) => {
      const num = asNumber(value)

      return num !== null && predicate(num)
    },
    { message },
  )
}

function stringRefine(
  schema: z.ZodType,
  message: string,
  predicate: (value: string) => boolean,
): z.ZodType {
  return schema.refine(
    (value) => {
      const str = asString(value)

      return str !== null && predicate(str)
    },
    { message },
  )
}

/** Rules applied only when their option is exactly true */
function applyBooleanRule(
  schema: z.ZodType,
  rule: string,
  ctx: BuildContext,
  state: BuildState,
): z.ZodType {
  const { key, kind } = ctx

  switch (rule) {
    case 'positive':
    case 'negative': {
      if (kind !== 'number') failUnsupported(rule, key)

      const isPositive = rule === 'positive'

      return numberRefine(
        schema,
        `"${key}" must be a ${isPositive ? 'positive' : 'negative'} number`,
        (value) => (isPositive ? value > 0 : value < 0),
      )
    }

    case 'port':
      if (kind !== 'number') failUnsupported(rule, key)

      return numberRefine(
        schema,
        `"${key}" must be a valid port`,
        (value) => Number.isInteger(value) && value >= 0 && value <= 65535,
      )

    case 'integer':
      if (kind !== 'number') failUnsupported(rule, key)

      return numberRefine(schema, `"${key}" must be an integer`, (value) => Number.isInteger(value))

    case 'isoDate':
    case 'iso':
      if (kind !== 'string') failUnsupported(rule, key)

      return schema.refine(
        (value) => ISO_DATE.safeParse(value).success || ISO_DATETIME.safeParse(value).success,
        { message: `"${key}" must be in ISO 8601 format` },
      )

    case 'creditCard':
      if (kind !== 'string') failUnsupported(rule, key)

      return schema.refine((value) => IS_CREDIT_CARD.safeParse(value).success, {
        message: `"${key}" must be a valid credit card number`,
      })

    case 'alphanum':
      if (kind !== 'string') failUnsupported(rule, key)

      return stringRefine(schema, `"${key}" must only contain alpha-numeric characters`, (value) =>
        /^[a-zA-Z0-9]+$/.test(value),
      )

    case 'token':
      if (kind !== 'string') failUnsupported(rule, key)

      return stringRefine(
        schema,
        `"${key}" must only contain alpha-numeric and underscore characters`,
        (value) => /^[a-zA-Z0-9_]+$/.test(value),
      )

    case 'hostname':
      if (kind !== 'string') failUnsupported(rule, key)

      return stringRefine(schema, `"${key}" must be a valid hostname`, (value) =>
        HOSTNAME_PATTERN.test(value),
      )

    case 'lowercase':
      if (kind !== 'string') failUnsupported(rule, key)

      return schema.transform((value) => asString(value)?.toLowerCase() ?? value)

    case 'uppercase':
      if (kind !== 'string') failUnsupported(rule, key)

      return schema.transform((value) => asString(value)?.toUpperCase() ?? value)

    case 'truthy':
    case 'falsy': {
      if (kind !== 'boolean') failUnsupported(rule, key)

      const expected = rule === 'truthy'

      return schema.refine((value) => value === expected, {
        message: `"${key}" must be ${expected}`,
      })
    }

    case 'truncate': {
      if (kind !== 'string') failUnsupported(rule, key)

      // Already handled alongside max (Joi: truncate makes max truncate
      // instead of fail) — don't transform twice
      if (state.truncated) return schema

      const limit = typeof ctx.config.max === 'number' ? ctx.config.max : null

      if (limit === null) throw new Error('"truncate" must have a max limit')

      state.truncated = true

      return schema.transform((value) => {
        const str = asString(value)

        return str !== null && str.length > limit ? str.slice(0, limit) : value
      })
    }

    case 'insensitive':
      state.insensitive = true

      return schema

    case 'forbidden':
      return schema.refine(() => false, { message: `"${key}" is not allowed` })

    // Presence rules are carried by the metamodel (PropertySchema) and
    // applied by validate(); nothing to do on the schema itself
    case 'required':
    case 'optional':
    case 'strip':
      return schema

    default:
      failUnsupported(rule, key)
  }
}

/** Rules applied with an options object, or with defaults when true */
function applyStringFormat(
  schema: z.ZodType,
  rule: string,
  options: Record<string, unknown>,
  ctx: BuildContext,
): z.ZodType {
  const { key } = ctx

  if (ctx.kind !== 'string') failUnsupported(rule, key)

  switch (rule) {
    case 'email':
      return schema.refine((value) => IS_EMAIL.safeParse(value).success, {
        message: `"${key}" must be a valid email`,
      })

    case 'uri':
      return schema.refine((value) => IS_URL.safeParse(value).success, {
        message: `"${key}" must be a valid uri`,
      })

    case 'ip':
      return schema.refine(
        (value) => IS_IPV4.safeParse(value).success || IS_IPV6.safeParse(value).success,
        { message: `"${key}" must be a valid ip address` },
      )

    case 'base64': {
      const pattern =
        options.paddingRequired === false ? /^[A-Za-z0-9+/]+(={0,2})?$/ : /^[A-Za-z0-9+/]+={0,2}$/

      return stringRefine(schema, `"${key}" must be a valid base64 string`, (value) =>
        pattern.test(value),
      )
    }

    case 'hex': {
      const allowPrefix = options.prefix === true
      const byteAligned = options.byteAligned === true

      return stringRefine(schema, `"${key}" must only contain hexadecimal characters`, (value) => {
        const body = allowPrefix ? value.replace(/^0x/i, '') : value

        if (!/^[0-9a-f]+$/i.test(body)) return false

        return !byteAligned || body.length % 2 === 0
      })
    }

    case 'normalize': {
      const form = typeof options.form === 'string' ? options.form : 'NFC'

      return schema.transform((value) => asString(value)?.normalize(form) ?? value)
    }

    default:
      failUnsupported(rule, key)
  }
}

/** Rules applied with their options as-is, on whichever base type supports them */
function applyGenericRule(
  schema: z.ZodType,
  rule: string,
  options: unknown,
  ctx: BuildContext,
  state: BuildState,
): z.ZodType {
  const { key, kind } = ctx

  switch (rule) {
    case 'min':
    case 'max': {
      if ((kind !== 'string' && kind !== 'number') || typeof options !== 'number') {
        failUnsupported(rule, key)
      }

      const limit: number = options
      const isMin = rule === 'min'

      if (kind === 'number') {
        return numberRefine(
          schema,
          isMin
            ? `"${key}" must be greater than or equal to ${limit}`
            : `"${key}" must be less than or equal to ${limit}`,
          (value) => (isMin ? value >= limit : value <= limit),
        )
      }

      // Joi semantics: truncate makes max truncate the value instead of
      // failing, so the limit is applied as a transform
      if (!isMin && ctx.config.truncate === true) {
        state.truncated = true

        return schema.transform((value) => {
          const str = asString(value)

          return str !== null && str.length > limit ? str.slice(0, limit) : value
        })
      }

      return stringRefine(
        schema,
        isMin
          ? `"${key}" length must be at least ${limit} characters long`
          : `"${key}" length must be less than or equal to ${limit} characters long`,
        (value) => (isMin ? value.length >= limit : value.length <= limit),
      )
    }

    case 'length': {
      if (kind !== 'string' || typeof options !== 'number') failUnsupported(rule, key)

      return stringRefine(
        schema,
        `"${key}" length must be ${options} characters long`,
        (value) => value.length === options,
      )
    }

    case 'precision': {
      if (kind !== 'number' || typeof options !== 'number') failUnsupported(rule, key)

      return numberRefine(
        schema,
        `"${key}" must have no more than ${options} decimal places`,
        (value) => decimalPlaces(value) <= options,
      )
    }

    case 'multiple': {
      if (kind !== 'number' || typeof options !== 'number') failUnsupported(rule, key)

      return numberRefine(
        schema,
        `"${key}" must be a multiple of ${options}`,
        (value) => value % options === 0,
      )
    }

    case 'regex': {
      if (kind !== 'string') failUnsupported(rule, key)

      const isRegExp = options instanceof RegExp
      const opts = isRegExp ? {} : ((options ?? {}) as Record<string, unknown>)
      const pattern = isRegExp ? options : opts.pattern
      const invert = opts.invert === true
      const name = typeof opts.name === 'string' ? opts.name : null

      if (!(pattern instanceof RegExp)) failUnsupported(rule, key)

      return stringRefine(
        schema,
        `"${key}" fails to match the ${name ? `"${name}"` : 'required'} pattern`,
        (value) => pattern.test(value) !== invert,
      )
    }

    case 'replace': {
      if (kind !== 'string') failUnsupported(rule, key)

      const opts = (options ?? {}) as Record<string, unknown>
      const pattern = opts.pattern
      const replacement = typeof opts.replace === 'string' ? opts.replace : ''

      if (!(pattern instanceof RegExp) && typeof pattern !== 'string') failUnsupported(rule, key)

      return schema.transform((value) => asString(value)?.replace(pattern, replacement) ?? value)
    }

    case 'before':
    case 'after': {
      if (kind !== 'temporal') failUnsupported(rule, key)

      const isBefore = rule === 'before'

      return schema.refine(
        (value) => {
          const valueDate = toDate(value)
          const boundary = options === 'now' ? new Date() : toDate(options)

          if (valueDate === null || boundary === null) return false

          return isBefore
            ? valueDate.getTime() <= boundary.getTime()
            : valueDate.getTime() >= boundary.getTime()
        },
        { message: `"${key}" must be ${isBefore ? 'before' : 'after'} the expected boundary` },
      )
    }

    case 'guid': {
      if (kind !== 'string') failUnsupported(rule, key)

      const version =
        (options as Record<string, unknown> | null)?.version === 'uuidv4' ? IS_UUID_V4 : IS_UUID

      return schema.refine((value) => version.safeParse(value).success, {
        message: `"${key}" must be a valid GUID`,
      })
    }

    case 'trim': {
      if (kind !== 'string') failUnsupported(rule, key)

      if (!options) return schema

      return schema.transform((value) => asString(value)?.trim() ?? value)
    }

    case 'allow': {
      const values = Array.isArray(options) ? options : [options]

      state.allowValues.push(...values)

      return schema
    }

    case 'valid': {
      const values = Array.isArray(options) ? options : [options]

      return schema.refine(
        (value) => values.some((expected) => matches(value, expected, state.insensitive)),
        { message: `"${key}" must be one of ${JSON.stringify(values)}` },
      )
    }

    case 'invalid': {
      const values = Array.isArray(options) ? options : [options]

      return schema.refine(
        (value) => !values.some((expected) => matches(value, expected, state.insensitive)),
        { message: `"${key}" contains an invalid value` },
      )
    }

    // We never coerce types, so Joi's strict mode is the default
    case 'strict':
      return schema

    // Empty values are treated as unset by validate() (Joi's default
    // `empty` value is ''); per-property empty sets need rule storage in
    // the metamodel first
    case 'empty':
      return schema

    default:
      failUnsupported(rule, key)
  }
}

function applyRule(
  schema: z.ZodType,
  rule: string,
  options: unknown,
  ctx: BuildContext,
  state: BuildState,
): z.ZodType {
  if (BOOLEAN_OR_OPTIONS_RULES.has(rule)) {
    if (options === undefined || options === false) return schema

    const opts =
      typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {}

    return applyStringFormat(schema, rule, opts, ctx)
  }

  if (BOOLEAN_TRUE_RULES.has(rule)) {
    if (options !== true) return schema

    return applyBooleanRule(schema, rule, ctx, state)
  }

  return applyGenericRule(schema, rule, options, ctx, state)
}

function baseSchemaFor(property: PropertySchema): { schema: z.ZodType; kind: RuleKind } {
  switch (property.getType()) {
    case PropertyType.STRING:
      return { schema: stringSchema, kind: 'string' }
    case PropertyType.INTEGER:
      return { schema: integerSchema, kind: 'number' }
    case PropertyType.FLOAT:
      return { schema: floatSchema, kind: 'number' }
    case PropertyType.NUMBER:
      return { schema: numberSchema, kind: 'number' }
    case PropertyType.BOOLEAN:
      return { schema: booleanSchema, kind: 'boolean' }
    case PropertyType.UUID:
      return { schema: uuidSchema, kind: 'string' }
    case PropertyType.DATE:
      return { schema: dateSchema, kind: 'temporal' }
    case PropertyType.TIME:
      return { schema: timeSchema, kind: 'temporal' }
    case PropertyType.DATETIME:
      return { schema: datetimeSchema, kind: 'temporal' }
    case PropertyType.LOCALTIME:
      return { schema: localtimeSchema, kind: 'temporal' }
    case PropertyType.LOCALDATETIME:
      return { schema: localdatetimeSchema, kind: 'temporal' }
    case PropertyType.POINT:
      return { schema: pointSchema, kind: 'point' }
    case PropertyType.DURATION:
      return { schema: durationSchema, kind: 'duration' }
    default:
      return { schema: anySchema, kind: 'any' }
  }
}

/**
 * Build the Zod schema for one property: its PropertyType base schema plus
 * the neode-style rule options (`{ min: 2, max: 50, email: true }`, keys in
 * neode's rule names). Unknown rules, or rules the base type does not
 * support, throw `Not sure how to validate <rule> on <key>` like neode.
 *
 * The neode-ogm metamodel does not store rule options yet (PropertySchema
 * has no config bag), so rules travel in the `config` argument — validate()
 * builds configless schemas until rule storage lands.
 */
export function buildPropertySchema(
  property: PropertySchema,
  config: Record<string, unknown> = {},
): z.ZodType {
  const { schema: base, kind } = baseSchemaFor(property)
  const ctx: BuildContext = { key: property.getKey(), kind, config }
  const state: BuildState = { insensitive: false, allowValues: [], truncated: false }

  let schema = base

  Object.keys(config).forEach((rule) => {
    if (IGNORED_KEYS.has(rule)) return

    schema = applyRule(schema, rule, config[rule], ctx, state)
  })

  // allow values bypass every other check (Joi semantics)
  if (state.allowValues.length) {
    schema = z.union([
      z.custom((value) =>
        state.allowValues.some((expected) => matches(value, expected, state.insensitive)),
      ),
      schema,
    ])
  }

  return property.isArray() ? z.array(schema) : schema
}
