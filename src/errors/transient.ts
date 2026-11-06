import NeodeError from './neode-error'

/**
 * A transient failure (`Neo.TransientError.*` codes, or the driver's /
 * engine's own `retryable` verdict): retrying the operation may succeed.
 * `isRetryable` is baked in by the code classification — a TransientError
 * is only ever created for a retryable failure.
 */
export default class TransientError extends NeodeError {
  readonly isRetryable = true

  constructor(
    message: string,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options)

    this.name = 'TransientError'
  }
}
