import neo4j, { type Config } from 'neo4j-driver'
import dotenv from 'dotenv'
import { Neo4jConnectionProvider } from './driver/neo4j-connection-provider.js'
import Neode from './neode.service.js'

const LOG_LEVELS = new Set(['error', 'warn', 'info', 'debug'])

// The full TrustStrategy union in neo4j-driver 6 (legacy driver 4/5 values
// such as TRUST_SIGNED_CERTIFICATES are no longer part of it)
const TRUST_STRATEGIES = [
  'TRUST_ALL_CERTIFICATES',
  'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES',
  'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES',
]

export interface EnvConnectionConfig {
  uri: string
  auth: ReturnType<typeof neo4j.auth.basic> | undefined
  config: Record<string, unknown>
  database: string
  enterprise: boolean
}

function warnIgnoring(environmentVariable: string, reason: string): void {
  console.warn(`fromEnv: ignoring ${environmentVariable} — ${reason}`)
}

/**
Pure process-env → connection mapping used by fromEnv().

`driverConfig` is merged verbatim over the env-derived config — any option
neo4j.driver accepts can be passed even when no NEO4J_* variable maps to
it. Explicit values win over env-derived ones; `undefined` entries are
skipped so a programmatically-built config does not clobber env values.

Audited against the neo4j-driver 6 config surface:
- `encrypted` / `trust` / `trustedCertificates` still exist, but the legacy
  `TRUST_SIGNED_CERTIFICATES` value was dropped from `TrustStrategy`
  (passed through with a warning).
- `knownHosts` and `loadBalancingStrategy` were removed entirely —
  warn + ignore.
- `logging` must be a `{ level, logger }` object; a raw string throws
  "Illegal logger function" at driver construction.
*/
export function configFromEnv(
  environment: NodeJS.ProcessEnv,
  driverConfig: Config = {},
): EnvConnectionConfig {
  const protocol = environment['NEO4J_PROTOCOL'] || 'bolt'
  const host = environment['NEO4J_HOST'] || 'localhost'
  const port = environment['NEO4J_PORT'] || '7687'

  const config: Record<string, unknown> = {}

  const ints: Record<string, string> = {
    NEO4J_MAX_CONNECTION_POOLSIZE: 'maxConnectionPoolSize',
    NEO4J_MAX_TRANSACTION_RETRY_TIME: 'maxTransactionRetryTime',
    NEO4J_MAX_CONNECTION_LIFETIME: 'maxConnectionLifetime',
    NEO4J_CONNECTION_TIMEOUT: 'connectionTimeout',
    NEO4J_CONNECTION_ACQUISITION_TIMEOUT: 'connectionAcquisitionTimeout',
  }

  for (const [setting, key] of Object.entries(ints)) {
    if (Object.hasOwn(environment, setting)) {
      config[key] = parseInt(environment[setting]!, 10)
    }
  }

  if (Object.hasOwn(environment, 'NEO4J_DISABLE_LOSSLESS_INTEGERS')) {
    config['disableLosslessIntegers'] = environment['NEO4J_DISABLE_LOSSLESS_INTEGERS'] === 'true'
  }

  if (Object.hasOwn(environment, 'NEO4J_ENCRYPTION')) {
    const value = environment['NEO4J_ENCRYPTION']!

    if (value === 'true' || value === 'ENCRYPTION_ON') {
      config['encrypted'] = true
    } else if (value === 'false' || value === 'ENCRYPTION_OFF') {
      config['encrypted'] = false
    } else {
      warnIgnoring('NEO4J_ENCRYPTION', `unknown value "${value}"`)
    }
  }

  if (Object.hasOwn(environment, 'NEO4J_TRUST')) {
    const value = environment['NEO4J_TRUST']!

    if (!TRUST_STRATEGIES.includes(value)) {
      console.warn(
        `fromEnv: NEO4J_TRUST "${value}" is not a driver 6 trust strategy (${TRUST_STRATEGIES.join(', ')}) — passing through as-is`,
      )
    }

    config['trust'] = value
  }

  if (Object.hasOwn(environment, 'NEO4J_TRUSTED_CERTIFICATES')) {
    config['trustedCertificates'] = environment['NEO4J_TRUSTED_CERTIFICATES']!.split(',')
  }

  if (Object.hasOwn(environment, 'NEO4J_LOGGING_LEVEL')) {
    const level = environment['NEO4J_LOGGING_LEVEL']!

    if (LOG_LEVELS.has(level)) {
      config['logging'] = neo4j.logging.console(level as 'error' | 'warn' | 'info' | 'debug')
    } else {
      warnIgnoring('NEO4J_LOGGING_LEVEL', `unknown level "${level}"`)
    }
  }
  // shortcut: removed in neo4j-driver 6 — warn + ignore, upgrade if the driver reintroduces them
  for (const setting of ['NEO4J_KNOWN_HOSTS', 'NEO4J_LOAD_BALANCING_STRATEGY']) {
    if (Object.hasOwn(environment, setting)) {
      warnIgnoring(setting, 'removed in neo4j-driver 6')
    }
  }

  return {
    uri: environment['NEO4J_URI'] || `${protocol}://${host}:${port}`,
    auth:
      environment['NEO4J_USERNAME'] && environment['NEO4J_PASSWORD']
        ? neo4j.auth.basic(environment['NEO4J_USERNAME'], environment['NEO4J_PASSWORD'])
        : undefined,
    config: {
      ...config,
      ...Object.fromEntries(
        Object.entries(driverConfig).filter(([, value]) => value !== undefined),
      ),
    },
    database: environment['NEO4J_DATABASE'] || 'neo4j',
    enterprise: environment['NEO4J_ENTERPRISE'] === 'true',
  }
}

/**
Load a .env file (dotenv does not clobber variables already set in
process.env), map the NEO4J_* variables to a connection config and
construct the neo4j driver. `driverConfig` — anything neo4j.driver
accepts, e.g. `disableLosslessIntegers: true` — is forwarded verbatim,
merged over the env-derived values.
*/
export function fromEnv(driverConfig: Config = {}): Neode {
  // Load vars from .env — dotenv does not clobber variables that are
  // already set in process.env
  dotenv.config()

  const { uri, auth, config, database, enterprise } = configFromEnv(process.env, driverConfig)

  const driver = neo4j.driver(uri, auth, config)

  return new Neode(new Neo4jConnectionProvider(driver, database), enterprise)
}
