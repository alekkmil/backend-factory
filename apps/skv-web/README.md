# SKV Web API

This NestJS application exposes the SKV enquiry API at `POST /api/enquiries`.
The request and response contract is maintained in
[`backend/forms-api.openapi.json`](../../backend/forms-api.openapi.json).

## Required configuration

- `DATABASE_URL`: connection string for this application's PostgreSQL database.
- `ENQUIRY_ENCRYPTION_KEY`: generate a dedicated 32-byte key encoded as base64
  (for example, `openssl rand -base64 32`). Keep it in the deployment secret
  store. Losing or rotating this key without a re-encryption plan makes stored
  enquiry fields unreadable.
- `CORS_ORIGINS`: origin allowlist also used to reject enquiry submissions from
  unrecognized browser origins. The endpoint does not enable cross-origin
  browser access; deploy it same-origin with the frontend.
- `ENQUIRY_PUBLIC_CONTEXTS_JSON`: the approved public context registry. Each
  entry contains a `sourcePath` and, when applicable, the exact `pageId`,
  `routeId` and/or `tunnelId` accepted with it. Populate it from the approved
  content/URL registry; do not invent IDs. If it is empty, the endpoint returns
  `503` rather than accepting an unregistered context.
- `TRUST_PROXY_HOPS`: trusted Express proxy hop count. Leave at `0` unless the
  request path is behind a known proxy chain; configure the actual hop count
  before relying on per-network rate limits.

The application rejects the example encryption-key placeholder at startup.
`ENQUIRY_PUBLIC_CONTEXTS_JSON` can remain empty during local setup, but requests
will not be accepted until it is populated.

## Enquiry storage and future delivery

Enquiry fields are encrypted before they are persisted. The enquiry record and
its notification outbox row are committed atomically. No email provider or
delivery worker is configured: outbox rows remain `pending` until a delivery
provider is selected and implemented. The intended recipient remains a
server-side policy; clients cannot select a recipient.

The outbox data model is retained so a future delivery provider can process
durably accepted enquiries. Provider credentials and sending configuration are
not needed for the current database-only implementation.

The `retentionUntil` field is intentionally left unset. No retention or deletion
policy is implemented pending data-owner approval.

## Database setup

Start the local PostgreSQL container from the repository root:

```bash
docker compose -f apps/skv-web/compose.yaml up -d
```

The container listens only on `127.0.0.1:5433`, persists data in the
`skv_web_postgres_data` Docker volume and has a health check. The development
credentials are `skvuser` / `skvpass`; do not reuse them outside local
development. To stop the database without deleting its data:

```bash
docker compose -f apps/skv-web/compose.yaml down
```

Do not add `--volumes`/`-v` to `down` unless you intend to delete the local
database contents.

Review the migration under `prisma/migrations/`, then apply it only to this
application's approved development database:

```bash
npx prisma migrate dev \
  --config apps/skv-web/prisma.config.ts \
  --name add_enquiry_outbox
```

For production, apply reviewed migrations with the deployment process using
`prisma migrate deploy`; do not run a reset or use `db push`.
