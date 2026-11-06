import NeodeError from './neode-error'

/**
 * A unique-constraint violation, raised on `merge()`/`create()` flows that
 * race an existing node. `label`/`property` are parsed from the database
 * message when it names them (Neo4j does; the embedded Relate engine only
 * names the constraint), and stay undefined otherwise.
 */
export default class ConstraintViolationError extends NeodeError {
  constructor(
    message: string,
    readonly label: string | undefined,
    readonly property: string | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options)

    this.name = 'ConstraintViolationError'
  }
}
