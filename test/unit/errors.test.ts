import { describe, expect, it } from 'vitest'
import { Driver, Session as DriverSession, Transaction as DriverTransaction } from 'neo4j-driver'

import {
  classifyError,
  ConstraintViolationError,
  isTransientError,
  NeodeError,
  TransientError,
} from '../../src/errors'
import { Neo4jConnectionProvider, Neo4jTransactionHandle } from '../../src/driver/neo4j'

/**
 * A Neo4jError / RelateError-shaped error: both carry the `code` and
 * `gqlStatus` classification fields (Relate additionally `retryable`),
 * which is all classifyError looks at.
 */
const driverError = (message: string, facts: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(message), facts)

describe('classifyError', () => {
  describe('constraint violations', () => {
    it('types a Neo4j 5.x unique violation and parses label and property', () => {
      const raw = driverError(
        "New node(4:123) with label `Movie` and property `title` = 'X' already exists with node(4:456)",
        { code: 'Neo.ClientError.Schema.ConstraintViolation', gqlStatus: '42N51' },
      )

      const typed = classifyError(raw) as ConstraintViolationError

      expect(typed).toBeInstanceOf(ConstraintViolationError)
      expect(typed).toBeInstanceOf(NeodeError)
      expect(typed.message).toBe(raw.message)
      expect(typed.label).toBe('Movie')
      expect(typed.property).toBe('title')
    })

    it('types a pre-5.x unique violation and parses label and property', () => {
      const typed = classifyError(
        driverError("Node(123) already exists with label `Movie` and property `title` = 'X'", {
          code: 'Neo.ClientError.Schema.ConstraintValidation',
        }),
      ) as ConstraintViolationError

      expect(typed).toBeInstanceOf(ConstraintViolationError)
      expect(typed.label).toBe('Movie')
      expect(typed.property).toBe('title')
    })

    it('types the Relate engine unique violation (message carries no label)', () => {
      const raw = driverError(
        'semantic error: ConstraintValidationFailed: `movie_title_unique` uniqueness',
        {
          code: 'Neo.ClientError.Schema.ConstraintValidationFailed',
          gqlStatus: '42000',
          retryable: false,
          stage: 'runtime',
        },
      )

      const typed = classifyError(raw) as ConstraintViolationError

      expect(typed).toBeInstanceOf(ConstraintViolationError)
      // The engine's message names only the constraint: label/property
      // stay undefined rather than guessed
      expect(typed.label).toBeUndefined()
      expect(typed.property).toBeUndefined()
    })

    it('preserves the original error as cause', () => {
      const raw = driverError('dup', {
        code: 'Neo.ClientError.Schema.ConstraintViolation',
      })

      const typed = classifyError(raw) as ConstraintViolationError

      expect(typed.cause).toBe(raw)
    })

    it('parses multi-property violations as the first property', () => {
      const typed = classifyError(
        driverError(
          "New node(1) with label `Movie` and properties `title` = 'X', `year` = 2000 already exists",
          { code: 'Neo.ClientError.Schema.ConstraintViolation' },
        ),
      ) as ConstraintViolationError

      expect(typed.label).toBe('Movie')
      expect(typed.property).toBe('title')
    })
  })

  describe('transient errors', () => {
    it('types Neo.TransientError.* codes as retryable', () => {
      const raw = driverError('Connection failed', {
        code: 'Neo.TransientError.Network.CommunicationError',
      })

      const typed = classifyError(raw) as TransientError

      expect(typed).toBeInstanceOf(TransientError)
      expect(typed).toBeInstanceOf(NeodeError)
      expect(typed.isRetryable).toBe(true)
      expect(typed.code).toBe('Neo.TransientError.Network.CommunicationError')
    })

    it('types retryable-flagged driver failures (ServiceUnavailable) as transient', () => {
      const typed = classifyError(
        driverError('Could not connect', { code: 'ServiceUnavailable', retryable: true }),
      ) as TransientError

      expect(typed).toBeInstanceOf(TransientError)
      expect(typed.isRetryable).toBe(true)
    })
  })

  describe('unknown errors', () => {
    it('leaves plain errors untouched', () => {
      const raw = new Error('boom')

      expect(classifyError(raw)).toBe(raw)
    })

    it('leaves non-taxonomy driver codes untouched', () => {
      const raw = driverError('variable not defined', {
        code: 'Neo.ClientError.Statement.SyntaxError',
        gqlStatus: '42N06',
      })

      expect(classifyError(raw)).toBe(raw)
    })

    it('leaves non-Error values untouched', () => {
      expect(classifyError('nope')).toBe('nope')
      expect(classifyError(undefined)).toBeUndefined()
    })

    it('is idempotent for already-typed errors', () => {
      const typed = new ConstraintViolationError('dup', 'Movie', 'title')

      expect(classifyError(typed)).toBe(typed)
    })
  })

  describe('isTransientError', () => {
    it('is true for classified transient errors', () => {
      const typed = classifyError(
        driverError('Connection failed', {
          code: 'Neo.TransientError.Network.CommunicationError',
        }),
      )

      expect(isTransientError(typed)).toBe(true)
    })

    it('is false for unclassified and other typed errors', () => {
      expect(
        isTransientError(
          driverError('Connection failed', {
            code: 'Neo.TransientError.Network.CommunicationError',
          }),
        ),
      ).toBe(false)
      expect(isTransientError(new ConstraintViolationError('dup', 'Movie', 'title'))).toBe(false)
    })
  })
})

describe('Neo4j provider classification wiring', () => {
  const constraintRaw = () =>
    driverError("New node(4:123) with label `Movie` and property `title` = 'X' already exists", {
      code: 'Neo.ClientError.Schema.ConstraintViolation',
    })

  const transientRaw = () =>
    driverError('Connection failed', {
      code: 'Neo.TransientError.Network.CommunicationError',
    })

  const fakeDriver = (error: unknown): Driver =>
    ({
      session: () => ({
        run: async () => {
          throw error
        },
        close: async () => {},
        beginTransaction: () => {
          throw error
        },
      }),
    }) as unknown as Driver

  it('surfaces run() failures as typed constraint violations', async () => {
    const raw = constraintRaw()
    const provider = new Neo4jConnectionProvider(fakeDriver(raw))

    const caught = await provider.run('CREATE (n:Movie)').then(
      () => null,
      (error) => error,
    )

    expect(caught).toBeInstanceOf(ConstraintViolationError)
    expect((caught as ConstraintViolationError).label).toBe('Movie')
  })

  it('surfaces run() failures as typed transient errors', async () => {
    const provider = new Neo4jConnectionProvider(fakeDriver(transientRaw()))

    const caught = await provider.run('RETURN 1').then(
      () => null,
      (error) => error,
    )

    expect(caught).toBeInstanceOf(TransientError)
    expect((caught as TransientError).isRetryable).toBe(true)
  })

  it('leaves unknown run() failures untouched', async () => {
    const raw = new Error('boom')
    const provider = new Neo4jConnectionProvider(fakeDriver(raw))

    const caught = await provider.run('RETURN 1').then(
      () => null,
      (error) => error,
    )

    expect(caught).toBe(raw)
  })

  it('surfaces beginTransaction() failures as typed transient errors', async () => {
    const provider = new Neo4jConnectionProvider(fakeDriver(transientRaw()))

    const caught = await provider.beginTransaction().then(
      () => null,
      (error) => error,
    )

    expect(caught).toBeInstanceOf(TransientError)
  })

  it('surfaces transaction run() failures as typed constraint violations', async () => {
    const raw = constraintRaw()
    const session = { close: async () => {} } as unknown as DriverSession
    const tx = {
      run: async () => {
        throw raw
      },
    } as unknown as DriverTransaction
    const handle = new Neo4jTransactionHandle(session, tx)

    const caught = await handle.run('CREATE (n:Movie)').then(
      () => null,
      (error) => error,
    )

    expect(caught).toBeInstanceOf(ConstraintViolationError)
  })
})
