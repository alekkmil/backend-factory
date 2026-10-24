type Environment = Record<string, unknown>;

const tunnelIds = new Set(['frejus', 'mont-blanc', 'not-sure']);

export function validateEnvironment(environment: Environment): Environment {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'production' &&
    nodeEnv !== 'test'
  ) {
    throw new Error('NODE_ENV must be development, production, or test');
  }

  const portValue = environment.PORT ?? '3001';
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const databaseUrl = environment.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (
    (parsedDatabaseUrl.protocol !== 'postgresql:' &&
      parsedDatabaseUrl.protocol !== 'postgres:') ||
    !parsedDatabaseUrl.hostname ||
    parsedDatabaseUrl.pathname.length < 2
  ) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }

  const originsValue = environment.CORS_ORIGINS;
  if (typeof originsValue !== 'string') {
    throw new Error('CORS_ORIGINS must contain one or more allowed origins');
  }

  const origins = originsValue
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain one or more allowed origins');
  }

  for (const origin of origins) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain valid HTTP(S) origins');
    }
    if (
      (parsedOrigin.protocol !== 'http:' &&
        parsedOrigin.protocol !== 'https:') ||
      parsedOrigin.origin !== origin
    ) {
      throw new Error('CORS_ORIGINS must contain valid HTTP(S) origins');
    }
  }

  const encryptionKeyValue = environment.ENQUIRY_ENCRYPTION_KEY;
  if (
    typeof encryptionKeyValue !== 'string' ||
    !isBase64Key(encryptionKeyValue)
  ) {
    throw new Error(
      'ENQUIRY_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }

  const trustProxyHopsValue = environment.TRUST_PROXY_HOPS ?? '0';
  const trustProxyHops = Number(trustProxyHopsValue);
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 10
  ) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10');
  }

  const enquiryPublicContexts = parsePublicContexts(
    environment.ENQUIRY_PUBLIC_CONTEXTS_JSON,
  );

  return {
    ...environment,
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: origins,
    ENQUIRY_ENCRYPTION_KEY: encryptionKeyValue,
    ENQUIRY_PUBLIC_CONTEXTS: enquiryPublicContexts,
    TRUST_PROXY_HOPS: trustProxyHops,
  };
}

function isBase64Key(value: string): boolean {
  const key = Buffer.from(value, 'base64');
  return (
    key.length === 32 &&
    key.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
  );
}

function parsePublicContexts(value: unknown): Array<Record<string, string>> {
  if (value === undefined || value === '') {
    return [];
  }
  if (typeof value !== 'string') {
    throw new Error('ENQUIRY_PUBLIC_CONTEXTS_JSON must be valid JSON');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('ENQUIRY_PUBLIC_CONTEXTS_JSON must be valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('ENQUIRY_PUBLIC_CONTEXTS_JSON must be a JSON array');
  }

  const seenContexts = new Set<string>();
  return parsed.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      !('sourcePath' in entry) ||
      typeof entry.sourcePath !== 'string' ||
      !/^\/(?!\/)[^?#]*$/.test(entry.sourcePath) ||
      entry.sourcePath.length > 300
    ) {
      throw new Error(
        'Each public enquiry context must have a valid sourcePath',
      );
    }
    if (Object.keys(entry).some((key) => !['sourcePath', 'pageId', 'routeId', 'tunnelId'].includes(key))) {
      throw new Error(
        'Public enquiry contexts may contain only sourcePath, pageId, routeId, and tunnelId',
      );
    }

    const context: Record<string, string> = {
      sourcePath: entry.sourcePath,
    };

    for (const key of ['pageId', 'routeId'] as const) {
      const id = entry[key];
      if (id !== undefined) {
        if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
          throw new Error(
            `Each public enquiry context ${key} must be a non-empty string up to 100 characters`,
          );
        }
        context[key] = id;
      }
    }

    const tunnelId = entry.tunnelId;
    if (tunnelId !== undefined) {
      if (typeof tunnelId !== 'string' || !tunnelIds.has(tunnelId)) {
        throw new Error(
          'Public enquiry context tunnelId must be frejus, mont-blanc, or not-sure',
        );
      }
      context.tunnelId = tunnelId;
    }

    const contextKey = [
      context.sourcePath,
      context.pageId ?? '',
      context.routeId ?? '',
      context.tunnelId ?? '',
    ].join('\u0000');
    if (seenContexts.has(contextKey)) {
      throw new Error('ENQUIRY_PUBLIC_CONTEXTS_JSON has duplicate contexts');
    }
    seenContexts.add(contextKey);

    return context;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
