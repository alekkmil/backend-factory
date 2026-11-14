import { isAbsolute } from 'node:path';
import { isEmail } from 'class-validator';

const defaultCorsOrigins = 'http://localhost:3000';

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (
    !['local', 'development', 'production', 'test'].includes(String(nodeEnv))
  ) {
    throw new Error('NODE_ENV must be local, development, production, or test');
  }

  const port = Number(environment.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const databaseUrl = environment.DATABASE_URL;
  const trustProxy = environment.TRUST_PROXY ?? 'false';
  if (trustProxy !== 'false' && trustProxy !== 'loopback') {
    throw new Error('TRUST_PROXY must be false or loopback');
  }
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

  const corsOrigins = String(environment.CORS_ORIGINS ?? defaultCorsOrigins)
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
  const devCataloguePublish =
    environment.DEV_CATALOGUE_PUBLISH_ENABLED ?? 'false';
  if (devCataloguePublish !== 'true' && devCataloguePublish !== 'false') {
    throw new Error('DEV_CATALOGUE_PUBLISH_ENABLED must be true or false');
  }
  if (devCataloguePublish === 'true' && nodeEnv === 'production') {
    throw new Error('Metadata-only catalogue publication is development-only');
  }
  if (devStaffAuthEnabled !== 'true' && devStaffAuthEnabled !== 'false') {
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
  const stockFactSourceCode = environment.STOCK_FACT_SOURCE_CODE ?? '';
  if (
    typeof stockFactSourceCode !== 'string' ||
    (stockFactSourceCode !== '' &&
      !/^[A-Za-z0-9._:-]{1,80}$/.test(stockFactSourceCode))
  ) {
    throw new Error('STOCK_FACT_SOURCE_CODE must be a valid source identifier');
  }
  if (outboxWorkerEnabled !== 'true' && outboxWorkerEnabled !== 'false') {
    throw new Error('OUTBOX_WORKER_ENABLED must be true or false');
  }
  const captureDirectory = environment.OUTBOX_CAPTURE_DIRECTORY ?? '';
  if (
    typeof captureDirectory !== 'string' ||
    (captureDirectory !== '' && !isAbsolute(captureDirectory))
  ) {
    throw new Error(
      'OUTBOX_CAPTURE_DIRECTORY must be an absolute private directory',
    );
  }
  const mailSettings = {
    host: environment.SMTP_HOST ?? '',
    port: environment.SMTP_PORT ?? '',
    user: environment.SMTP_USER ?? '',
    password: environment.SMTP_PASSWORD ?? '',
    from: environment.MAIL_FROM ?? '',
    sandboxRecipient: environment.MAIL_TO ?? '',
  };
  const smtpConfigured = Object.values(mailSettings).some(
    (value) => value !== '' && value !== undefined,
  );
  let smtpPort = 0;
  if (smtpConfigured) {
    if (
      typeof mailSettings.host !== 'string' ||
      !mailSettings.host.trim() ||
      /[\r\n]/.test(mailSettings.host) ||
      typeof mailSettings.user !== 'string' ||
      !mailSettings.user.trim() ||
      typeof mailSettings.password !== 'string' ||
      !mailSettings.password ||
      typeof mailSettings.from !== 'string' ||
      !isEmail(mailSettings.from) ||
      typeof mailSettings.sandboxRecipient !== 'string' ||
      !isEmail(mailSettings.sandboxRecipient)
    ) {
      throw new Error(
        'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM and MAIL_TO must all be configured with valid values',
      );
    }
    smtpPort = Number(mailSettings.port);
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      throw new Error('SMTP_PORT must be an integer between 1 and 65535');
    }
    if (nodeEnv === 'production') {
      throw new Error(
        'SMTP transport is not enabled for production; configure it in the production mail deployment task',
      );
    }
  }
  if (outboxWorkerEnabled === 'true') {
    if (nodeEnv === 'production') {
      throw new Error(
        'Outbox worker requires a reviewed production adapter; local capture is development-only',
      );
    }
    if (!smtpConfigured && !captureDirectory) {
      throw new Error(
        'Configure SMTP sandbox delivery or OUTBOX_CAPTURE_DIRECTORY when the worker is enabled',
      );
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
      throw new Error(
        `${name} must be an integer between ${minimum} and ${maximum}`,
      );
    }
    workerNumbers[name] = value;
  }
  if (workerNumbers.OUTBOX_RETRY_MAX_MS < workerNumbers.OUTBOX_RETRY_BASE_MS) {
    throw new Error(
      'OUTBOX_RETRY_MAX_MS must be at least OUTBOX_RETRY_BASE_MS',
    );
  }

  return {
    ...environment,
    NODE_ENV: nodeEnv,
    PORT: port,
    TRUST_PROXY: trustProxy,
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: corsOrigins.join(','),
    DEV_STAFF_AUTH_ENABLED: devStaffAuthEnabled === 'true',
    DEV_CATALOGUE_PUBLISH_ENABLED: devCataloguePublish === 'true',
    OUTBOX_WORKER_ENABLED: outboxWorkerEnabled === 'true',
    STOCK_FACT_SOURCE_CODE: stockFactSourceCode,
    OUTBOX_CAPTURE_DIRECTORY: captureDirectory,
    SMTP_HOST: smtpConfigured ? String(mailSettings.host).trim() : '',
    SMTP_PORT: smtpPort,
    SMTP_USER: smtpConfigured ? String(mailSettings.user).trim() : '',
    SMTP_PASSWORD: smtpConfigured ? mailSettings.password : '',
    MAIL_FROM: smtpConfigured ? String(mailSettings.from).trim() : '',
    MAIL_TO: smtpConfigured ? String(mailSettings.sandboxRecipient).trim() : '',
    ...workerNumbers,
  };
}
