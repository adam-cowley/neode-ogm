/**
Validation error — port of neode's ValidationError.

Shape: a `details` array with one entry per failed check (Joi detail shape:
message, path, type), and the original `input` object. Unlike neode's
single-throw-per-check Joi call, all issues are collected (zod's
non-abortive checks ≙ Joi's abortEarly: false).
*/
export const ERROR_VALIDATION = 'ERROR_VALIDATION'

/**
One failed check, shaped like a Joi detail
*/
export interface ValidationDetail {
  message: string
  path: (string | number)[]
  type: string
}

export class ValidationError extends Error {
  readonly details: ValidationDetail[]
  readonly input: Record<string, unknown>

  /**
  The underlying zod error, for consumers that want the full issue list
  */
  readonly zodError: unknown

  constructor(details: ValidationDetail[], input: Record<string, unknown>, zodError?: unknown) {
    const keys = [
      ...new Set(details.map((detail) => detail.path[0]).filter((key) => key !== undefined)),
    ]

    super(
      keys.length > 0
        ? `${ERROR_VALIDATION}: ${keys.map((key) => `"${String(key)}"`).join(', ')}`
        : ERROR_VALIDATION,
    )

    this.name = 'ValidationError'
    this.details = details
    this.input = input
    this.zodError = zodError
  }
}
