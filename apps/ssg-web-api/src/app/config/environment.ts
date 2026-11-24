import { isAbsolute } from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { isEmail } from 'class-validator';
import { boricaGatewayPublicKey } from '../modules/payments/borica-signature';

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

  const sessionCookieSameSite = environment.SESSION_COOKIE_SAME_SITE ?? 'lax';
  if (sessionCookieSameSite !== 'lax' && sessionCookieSameSite !== 'none') {
    throw new Error('SESSION_COOKIE_SAME_SITE must be lax or none');
  }

  const checkoutEnabled = environment.CHECKOUT_ENABLED ?? 'false';
  if (checkoutEnabled !== 'true' && checkoutEnabled !== 'false') {
    throw new Error('CHECKOUT_ENABLED must be true or false');
  }
  const decodeKey = (name: string): Buffer => {
    const value = environment[name];
    if (
      typeof value !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) ||
      value.length === 0
    ) {
      throw new Error(`${name} must be a non-empty base64-encoded key or certificate`);
    }
    return Buffer.from(value, 'base64');
  };
  if (environment.BORICA_GATEWAY_PUBLIC_KEY_BASE64 || checkoutEnabled === 'true') {
    try {
      boricaGatewayPublicKey(String(environment.BORICA_GATEWAY_PUBLIC_KEY_BASE64 ?? ''));
    } catch {
      throw new Error('BORICA_GATEWAY_PUBLIC_KEY_BASE64 must encode a valid 2048-bit RSA PEM public key');
    }
  }
  const checkoutNumbers: Record<string, number> = {};
  if (checkoutEnabled === 'true' || environment.BORICA_GATEWAY_PUBLIC_KEY_BASE64) {
    for (const [name, min, max] of [
      ['CHECKOUT_QUOTE_TTL_SECONDS', 1, 86400],
      ['ORDER_ACCESS_GRANT_TTL_SECONDS', 1, 2592000],
      ['ORDER_ACCESS_SESSION_TTL_SECONDS', 1, 2592000],
      ['ORDER_ACCESS_LOOKUP_TTL_SECONDS', 1, 86400],
      ['PAYMENT_RECONCILE_INTERVAL_SECONDS', 5, 3600],
      ['BORICA_REQUEST_TIMEOUT_MS', 1000, 60000],
    ] as const) {
      const value = Number(environment[name]);
      if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
      }
      checkoutNumbers[name] = value;
    }
    const expectedGateway = nodeEnv === 'production'
      ? 'https://3dsgate.borica.bg/cgi-bin/cgi_link'
      : 'https://3dsgate-dev.borica.bg/cgi-bin/cgi_link';
    if (environment.BORICA_GATEWAY_URL !== expectedGateway) {
      throw new Error('BORICA_GATEWAY_URL must match the documented gateway for NODE_ENV');
    }
    const terminal = environment.BORICA_TERMINAL_ID;
    const merchant = environment.BORICA_MERCHANT_ID;
    const name = environment.BORICA_MERCHANT_NAME;
    if (
      typeof terminal !== 'string' || !/^[A-Za-z0-9]{8}$/.test(terminal) ||
      typeof merchant !== 'string' || !/^[A-Za-z0-9]{10}$/.test(merchant) ||
      typeof name !== 'string' || name.trim().length === 0 ||
      name.length > 80 || /\p{C}/u.test(name)
    ) {
      throw new Error('BORICA terminal, merchant ID and merchant name are required');
    }
    try {
      const privateKey = createPrivateKey(decodeKey('BORICA_PRIVATE_KEY_BASE64'));
      if (privateKey.asymmetricKeyType !== 'rsa' ||
          privateKey.asymmetricKeyDetails?.modulusLength !== 2048) {
        throw new Error('Invalid bank signing key');
      }
      const bankKey = boricaGatewayPublicKey(String(environment.BORICA_GATEWAY_PUBLIC_KEY_BASE64));
      if (bankKey.export({ type: 'spki', format: 'der' }).equals(
        createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
      )) {
        throw new Error('Merchant signing key cannot be the gateway verification key');
      }
    } catch {
      throw new Error('BORICA signing and gateway verification keys must be valid and distinct');
    }
    try {
      const origin = new URL(String(environment.PUBLIC_SITE_ORIGIN));
      const returnUrl = new URL(String(environment.BORICA_BROWSER_RETURN_URL));
      const accessUrl = new URL(String(environment.ORDER_ACCESS_URL));
      if (
        !['http:', 'https:'].includes(origin.protocol) ||
        (origin.protocol === 'http:' &&
          !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) ||
        origin.pathname !== '/' || origin.search || origin.hash ||
        origin.username || origin.password ||
        (returnUrl && (returnUrl.origin !== origin.origin || returnUrl.username ||
          returnUrl.password || returnUrl.search || returnUrl.hash)) ||
        accessUrl.origin !== origin.origin || accessUrl.username || accessUrl.password ||
        accessUrl.search || accessUrl.hash
      ) throw new Error('Invalid checkout return URL');
    } catch {
      throw new Error('Checkout return and order-access URLs must be on the configured public site origin');
    }
    if (decodeKey('ORDER_ACCESS_ENCRYPTION_KEY_BASE64').length !== 32) {
      throw new Error('ORDER_ACCESS_ENCRYPTION_KEY_BASE64 must encode 32 bytes');
    }
  }

  const devStaffAuthEnabled = environment.DEV_STAFF_AUTH_ENABLED ?? 'false';
  const devCataloguePublish =
    environment.DEV_CATALOGUE_PUBLISH_ENABLED ?? 'false';
  const prodCataloguePublish =
    environment.PROD_CATALOGUE_PUBLISH_ENABLED ?? 'false';
  if (devCataloguePublish !== 'true' && devCataloguePublish !== 'false') {
    throw new Error('DEV_CATALOGUE_PUBLISH_ENABLED must be true or false');
  }
  if (devCataloguePublish === 'true' && nodeEnv === 'production') {
    throw new Error('Metadata-only catalogue publication is development-only');
  }
  if (prodCataloguePublish !== 'true' && prodCataloguePublish !== 'false') {
    throw new Error('PROD_CATALOGUE_PUBLISH_ENABLED must be true or false');
  }
  if (prodCataloguePublish === 'true' && nodeEnv !== 'production') {
    throw new Error('Production catalogue publication requires NODE_ENV=production');
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

  const prodStaffAuthEnabled = environment.PROD_STAFF_AUTH_ENABLED ?? 'false';
  if (prodStaffAuthEnabled !== 'true' && prodStaffAuthEnabled !== 'false') {
    throw new Error('PROD_STAFF_AUTH_ENABLED must be true or false');
  }
  if (prodStaffAuthEnabled === 'true') {
    if (nodeEnv !== 'production') {
      throw new Error('Production staff authentication requires NODE_ENV=production');
    }
    for (const name of ['PROD_STAFF_AUTH_TOKEN', 'PROD_STAFF_CSRF_TOKEN']) {
      const token = environment[name];
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
        throw new Error(`${name} must be a 32-byte random token encoded as lowercase hexadecimal`);
      }
    }
    if (environment.PROD_STAFF_AUTH_TOKEN === environment.PROD_STAFF_CSRF_TOKEN) {
      throw new Error('Production staff tokens must be distinct');
    }
    if (typeof environment.PROD_STAFF_PRINCIPAL_ID !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          environment.PROD_STAFF_PRINCIPAL_ID,
        )) {
      throw new Error('PROD_STAFF_PRINCIPAL_ID must be a valid staff principal UUID');
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
  const smtpConfigured = Object.entries(mailSettings).some(
    ([name, value]) => name !== 'sandboxRecipient' && value !== '' && value !== undefined,
  );
  const localTestMailEnabled =
    environment.LOCAL_TEST_MAIL_ENABLED ?? 'false';
  if (
    localTestMailEnabled !== 'true' &&
    localTestMailEnabled !== 'false'
  ) {
    throw new Error('LOCAL_TEST_MAIL_ENABLED must be true or false');
  }
  if (localTestMailEnabled === 'true') {
    if (nodeEnv === 'production') {
      throw new Error('Local test mail is disabled in production');
    }
    if (!smtpConfigured) {
      throw new Error(
        'SMTP sandbox settings are required when local test mail is enabled',
      );
    }
  }
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
      (nodeEnv !== 'production' && !isEmail(mailSettings.sandboxRecipient))
    ) {
      throw new Error(
        'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM and MAIL_TO must all be configured with valid values',
      );
    }
    smtpPort = Number(mailSettings.port);
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      throw new Error('SMTP_PORT must be an integer between 1 and 65535');
    }
  }
  if (outboxWorkerEnabled === 'true') {
    if (!smtpConfigured && !captureDirectory) {
      throw new Error(
        'Configure SMTP sandbox delivery or OUTBOX_CAPTURE_DIRECTORY when the worker is enabled',
      );
    }
    if (nodeEnv !== 'production' && (typeof mailSettings.sandboxRecipient !== 'string' ||
        !isEmail(mailSettings.sandboxRecipient))) {
      throw new Error('MAIL_TO must be a controlled test recipient outside production');
    }
  }
  if (nodeEnv === 'production' && (captureDirectory ||
      (checkoutEnabled === 'true' && (!smtpConfigured || outboxWorkerEnabled !== 'true')))) {
    throw new Error('Production checkout requires SMTP and the outbox worker; local mail capture is prohibited');
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
    SESSION_COOKIE_SAME_SITE: sessionCookieSameSite,
    CHECKOUT_ENABLED: checkoutEnabled === 'true',
    ...checkoutNumbers,
    DEV_STAFF_AUTH_ENABLED: devStaffAuthEnabled === 'true',
    PROD_STAFF_AUTH_ENABLED: prodStaffAuthEnabled === 'true',
    DEV_CATALOGUE_PUBLISH_ENABLED: devCataloguePublish === 'true',
    PROD_CATALOGUE_PUBLISH_ENABLED: prodCataloguePublish === 'true',
    OUTBOX_WORKER_ENABLED: outboxWorkerEnabled === 'true',
    LOCAL_TEST_MAIL_ENABLED: localTestMailEnabled === 'true',
    STOCK_FACT_SOURCE_CODE: stockFactSourceCode,
    OUTBOX_CAPTURE_DIRECTORY: captureDirectory,
    SMTP_HOST: smtpConfigured ? String(mailSettings.host).trim() : '',
    SMTP_PORT: smtpPort,
    SMTP_USER: smtpConfigured ? String(mailSettings.user).trim() : '',
    SMTP_PASSWORD: smtpConfigured ? mailSettings.password : '',
    MAIL_FROM: smtpConfigured ? String(mailSettings.from).trim() : '',
    MAIL_TO: String(mailSettings.sandboxRecipient).trim(),
    ...workerNumbers,
  };
}
