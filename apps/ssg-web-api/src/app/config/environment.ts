import { isAbsolute } from 'node:path';

const defaultCorsOrigins = 'http://localhost:3000';

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (!['local', 'development', 'production', 'test'].includes(String(nodeEnv))) {
    throw new Error('NODE_ENV must be local, development, production, or test');
  }

  const port = Number(environment.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const databaseUrl = environment.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }

  const corsOrigins = String(
    environment.CORS_ORIGINS ?? defaultCorsOrigins,
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin');
  }

  for (const origin of corsOrigins) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain valid HTTP or HTTPS origins');
    }

    if (
      !['http:', 'https:'].includes(parsedOrigin.protocol) ||
      parsedOrigin.origin !== origin
    ) {
      throw new Error('CORS_ORIGINS must contain valid HTTP or HTTPS origins');
    }
  }

  const devStaffAuthEnabled = environment.DEV_STAFF_AUTH_ENABLED ?? 'false';
  if (
    devStaffAuthEnabled !== 'true' &&
    devStaffAuthEnabled !== 'false'
  ) {
    throw new Error('DEV_STAFF_AUTH_ENABLED must be true or false');
  }
  if (devStaffAuthEnabled === 'true') {
    if (nodeEnv === 'production') {
      throw new Error(
        'Development staff authentication is disabled in production',
      );
    }
    for (const name of ['DEV_STAFF_AUTH_TOKEN', 'DEV_STAFF_CSRF_TOKEN']) {
      const token = environment[name];
      if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') < 32) {
        throw new Error(
          `${name} must contain at least 32 characters when development staff authentication is enabled`,
        );
      }
    }
  }

  const outboxWorkerEnabled = environment.OUTBOX_WORKER_ENABLED ?? 'false';
  if (outboxWorkerEnabled !== 'true' && outboxWorkerEnabled !== 'false') {
    throw new Error('OUTBOX_WORKER_ENABLED must be true or false');
  }
  const captureDirectory = environment.OUTBOX_CAPTURE_DIRECTORY ?? '';
  if (
    typeof captureDirectory !== 'string' ||
    (captureDirectory !== '' && !isAbsolute(captureDirectory))
  ) {
    throw new Error('OUTBOX_CAPTURE_DIRECTORY must be an absolute private directory');
  }
  if (outboxWorkerEnabled === 'true') {
    if (nodeEnv === 'production') {
      throw new Error('Outbox worker requires a reviewed production adapter; local capture is development-only');
    }
    if (!captureDirectory) {
      throw new Error('OUTBOX_CAPTURE_DIRECTORY is required when the worker is enabled');
    }
  }
  const workerNumbers: Record<string, number> = {};
  for (const [name, defaultValue, minimum, maximum] of [
    ['OUTBOX_POLL_INTERVAL_MS', 1000, 100, 60000],
    ['OUTBOX_LEASE_MS', 60000, 10000, 300000],
    ['OUTBOX_MAX_ATTEMPTS', 5, 1, 20],
    ['OUTBOX_RETRY_BASE_MS', 5000, 1000, 3600000],
    ['OUTBOX_RETRY_MAX_MS', 300000, 1000, 86400000],
  ] as const) {
    const value = Number(environment[name] ?? defaultValue);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    workerNumbers[name] = value;
  }
  if (workerNumbers.OUTBOX_RETRY_MAX_MS < workerNumbers.OUTBOX_RETRY_BASE_MS) {
    throw new Error('OUTBOX_RETRY_MAX_MS must be at least OUTBOX_RETRY_BASE_MS');
  }

  return {
    ...environment,
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: corsOrigins.join(','),
    DEV_STAFF_AUTH_ENABLED: devStaffAuthEnabled === 'true',
    OUTBOX_WORKER_ENABLED: outboxWorkerEnabled === 'true',
    OUTBOX_CAPTURE_DIRECTORY: captureDirectory,
    ...workerNumbers,
  };
}
