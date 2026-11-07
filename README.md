# BackendFactory

## ssg-web-api

The NestJS application lives in `apps/ssg-web-api` and listens on port 3001
by default. Its database health endpoint is `GET /internal/health`.

Copy `apps/ssg-web-api/.env.example` to `apps/ssg-web-api/.env`, then start
its local PostgreSQL database (host port 5433):

```sh
docker compose -f apps/ssg-web-api/docker-compose.yml --env-file apps/ssg-web-api/.env up -d
npx nx serve ssg-web-api
```

Use `npx nx build ssg-web-api` to build. Prisma targets are
`prisma-generate`, `prisma-validate`, `prisma-migrate-dev`, and
`prisma-migrate-deploy`; for example, `npx nx run ssg-web-api:prisma-generate`.
Builds generate the application-local Prisma Client automatically.
The example credentials are for local development only.

The application was renamed from `skv-web-api`. Its local `.env`, Prisma
migrations and implementation sources moved with it. Database credentials,
database names and the legacy Docker Compose project/volume identity remain
unchanged so existing imported products and database containers are reused.
The Postman collection is `apps/ssg-web-api/postman/ssg-web-api.postman_collection.json`.

### Dev deployment to AWS Lightsail

Pushes to `dev` that change this application, shared libraries/tooling, or root
build configuration run
[Deploy ssg-web-api (dev)](.github/workflows/deploy-ssg-web-api-dev.yml).
Manual runs must also select `dev`; other branches do not deploy.
The deployment runs as a direct job with `environment: ssg-web-api-dev` and reads
its environment secrets through `${{ secrets.NAME }}`. No repository-secret
copies or `secrets: inherit` are required. It validates that all five secrets
are available before installing dependencies, without printing their values.
The workflow builds with Nx,
ships only compiled output and its generated runtime manifest/lockfile over
verified SSH, installs production dependencies on the server, applies pending
Prisma migrations, and starts/restarts the application's PM2 process.
The artifact also includes this application's schema, migration history and
Prisma config, plus a separate lockfile for the migration CLI using the
repository's installed Prisma version. No Docker, AWS access keys, or source
checkout on the server is needed.
The webpack build already generates the runtime lockfile; this workflow does
not use the separate Nx `prune` target.
The SSG webpack configuration explicitly includes `@prisma/client` as a runtime
dependency because the generated Prisma Client's runtime import is not inferred
by Nx's project graph. Packaging checks literal external imports in the compiled
bundle against the isolated runtime installation before uploading a release.

One-time server setup (Ubuntu Lightsail with a static public IP):

1. Install Node.js 24, npm and PM2, plus `curl`, `tar`, and `util-linux` (`flock`).
   All must be on the deployment user's non-interactive SSH `PATH`.
2. Use the user that owns your PM2 daemon (for example, `deploy`), with an SSH
   key and an application-owned
   directory:
   ```sh
   sudo install -d -m 700 -o deploy -g deploy /srv/ssg-web-api
   ```
3. As that user, configure PM2 reboot persistence:
   ```sh
   pm2 startup
   ```
   Execute the privileged setup command PM2 prints. The workflow runs `pm2 save`
   after healthy deployments. Use the same user and `PM2_HOME` for SSH deployment,
   administration and startup; do not run deployment PM2 commands with sudo.
   The process name is `ssg-web-api`. Its
   [ecosystem config](tools/deploy/ecosystem.config.cjs) ships with each release.
   If the earlier application-specific systemd service was installed, disable
   and stop it before switching so it cannot compete for port 3001.
4. Provision the application's PostgreSQL database and grant its deployment
   database user the permissions needed to apply migrations. Each deploy runs
   `prisma migrate deploy` on Lightsail using only this application's
   `DATABASE_URL` from `APP_ENV`. No pending migrations is a successful no-op.
   Review committed SQL before pushing; destructive migrations require explicit
   approval and backups. Use additive, backward-compatible migrations because
   the old application remains running while migrations apply.
5. Configure an HTTPS reverse proxy to `127.0.0.1:3001`. Do not expose port 3001,
   PostgreSQL, or `/internal/health` publicly. Allow SSH in the Lightsail firewall
   from your deployment runner (use a fixed-egress runner if strict IP allowlisting
   is required).

Create the GitHub **Environment** `ssg-web-api-dev`, restrict its deployment
branches to `dev`, and add these **environment secrets**:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | Lightsail static IPv4 address or DNS hostname |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | Dedicated deployment private key |
| `SSH_KNOWN_HOSTS` | Server's known-hosts entry, verified using a trusted console; do not blindly trust a live `ssh-keyscan` |
| `APP_ENV` | Complete multiline application environment file |

`APP_ENV` uses dotenv syntax: one `KEY=value` per line,
without `export` or variable interpolation. Start from the application's
[environment example](apps/ssg-web-api/.env.example), set `PORT=3001`, configure
the dev database and frontend CORS origin, and replace all example credentials.
For this development instance, use `NODE_ENV=development` and keep
`DEV_STAFF_AUTH_ENABLED=false` and `OUTBOX_WORKER_ENABLED=false` unless those
development features are explicitly configured.
Real production staff authentication is not implemented by this deployment.
If local capture is intentionally enabled in a development environment, keep
its private directory under `/srv/ssg-web-api/shared`, never in a release
directory.

Deployments are serialized per application/environment and additionally locked
on the server. A failed restart or database health check restores the previous
build and environment; a failed first deployment removes the PM2 process and fails
the action. Expect a brief restart interruption, not zero-downtime deployment.
PM2 deletes/recreates only this application's process to avoid retaining removed
environment variables. Migration failure aborts before changing the running
application; applied migrations are never automatically rolled back, including
partially applied SQL. Resolve migration failures explicitly before redeploying.
Old releases are retained for recovery; periodically remove only confirmed
inactive releases to manage disk usage. Inspect service logs on the server,
not public action logs, since they can contain operational details.
If deployment fails its health check, inspect the application's retained PM2
error/output logs under the deployment user's `PM2_HOME` (usually `~/.pm2/logs`).
The action reports connection/HTTP failures without printing response bodies;
a PM2 `online` status alone does not prove the application finished startup.

To add another application, create its own direct workflow, GitHub environment,
server directory and unique PM2 process name (derived from the application name).
Use the SSG workflow as a starting point, updating its name, app path filter,
branch guard, concurrency group, environment, `APP`, `APP_PORT`, `HEALTH_PATH`,
and secret-validation environment name. Reuse
[the server deployment script](tools/deploy/lightsail.sh) and
[PM2 ecosystem config](tools/deploy/ecosystem.config.cjs).
The application must emit
`main.js`, `package.json`, and `package-lock.json` under `dist/apps/<name>` and
provide a health endpoint returning HTTP 2xx with `{"status":"ok"}`.
It must also own a Prisma config and migration directory, since the deployment
workflow runs migrations for each deployment.
Keep every application's database, secrets and process isolated.

### Frontend catalogue, search and enquiries

| Requirement | API |
| --- | --- |
| BG/EN published products, descriptions, material/gemstone specifications and approved CDN images | `GET /api/catalog`, `GET /api/products/:id`, `GET /api/products/resolve` |
| Current prices, availability and eligible selectable physical units | Product `commercial_result` and detail `stock_choices` |
| Categories, filter options/counts, sorting, pagination and totals | `GET /api/catalog`, `GET /api/dictionaries` |
| Product search with independent product/content paging and counts | `GET /api/search` |
| Refresh local favourites or HOME selections | `POST /api/products/batch` (maximum 50 UUIDs; no favourites storage) |
| Contact, callback and similar-jewellery enquiries | `POST /api/enquiries`, `POST /api/enquiries/attempt-status` |

Public product reads exclude drafts, hidden products and missing requested
translations. Prices and stock choices use the existing commercial evaluator:
staged import units are not live available stock. `PUBLIC_SITE_ORIGIN` and
`MEDIA_CDN_BASE_URL` must be configured; missing required routes/media or failed
dependencies fail explicitly rather than manufacturing available products.
Batch lookup deduplicates IDs in first-occurrence order; unknown/hidden or
untranslated IDs return `unavailable`, with no N+1 per-product database reads.

Search example:

```http
GET /api/search?locale=en&q=gold&product_page=1&content_page=1&page_size=24
```

`locale` and `q` are required. The trimmed NFC query is at most 200 characters;
empty/whitespace queries return two empty groups without scanning the database.
Page numbers default to 1; page size defaults to 24 and is limited to 100.
Products match localized published names/descriptions using literal,
case-insensitive substring matching, then the existing product projection.
The response contains `query`, `locale`, `products` and `content`; each group
has `items`, `total`, `page` and `page_size`. Stable ID ordering and a
repeatable-read snapshot keep pages and counts consistent within each request.
Search sends `X-Robots-Tag: noindex`.

The content group searches published titles/intros and plain-text section
fields, plus localized store names/addresses and current published policies.
HOME/contact wrappers are intentionally excluded; private evidence, link target
IDs and untranslated/unpublished content are not searched. Optional content
preview thumbnails are currently `null`. Content matching is performed
server-side over published localized records; a large editorial catalogue
would need an indexed search projection.

For enquiries, first `POST /api/guest-session` with `{}` and an allowed
`Origin`. Keep its Secure HttpOnly cookie and send its `csrf_token` as
`X-CSRF-Token` with the same `Origin`. Browser requests must use
`credentials: 'include'`; credentialed CORS accepts only configured origins.
Use HTTPS, with frontend and API on the same site for the existing
`SameSite=Lax` cookie. HTTP localhost can be used where the client accepts
Secure localhost cookies; other plain HTTP environments cannot.

```json
{
  "request_id": "33333333-3333-4333-8333-333333333333",
  "request_type": "general",
  "name": "Example Customer",
  "email": "customer@example.com",
  "topic": "Product enquiry",
  "message": "Please contact me about your jewellery.",
  "language": "en",
  "origin_route_id": "R050"
}
```

`request_type` is `general`, `callback` or `similar_jewellery_creation`.
An international `phone` is required for the latter two; optional fields must
be omitted, not `null`. Similar-jewellery enquiries require
`context: {"type":"product","id":"<published jewellery UUID>"}`.
Optional contexts also accept published `content` UUIDs and the `store` IDs
`sofia`/`nessebar`. Contexts and origin route IDs are checked server-side against
the registry and published data; a route pattern does not activate a page.
Names/topics/messages are plain text, trimmed and NFC-normalized, with limits
of 200/250/10000 characters. Emails are limited to 320 and phones to 40.
Client-supplied recipients, unknown properties and invalid nested fields are
rejected.

New submissions return HTTP 201 and `{"state":"received","reference":"<UUID>"}`.
The inquiry, one durable notification intent and one audit event commit
atomically. Reusing the same `request_id` in the same live guest session with
the same normalized payload returns the original receipt (HTTP 200), even if
publication/configuration later changes. A different payload returns HTTP 409.
Do not generate a fresh ID after a timeout: send
`{"request_id":"<original UUID>"}` to `POST /api/enquiries/attempt-status`.
It returns the receipt or `{"state":"unknown_result"}`; it never exposes
another guest's submission or sends mail. No enquiry body/contact details are
returned publicly or logged.

Spam protection combines Origin/CSRF checks, strict bounded validation,
durable serialized limits (5 new enquiries/minute and 20/hour per guest;
20/minute and 100/hour per IP) and a bounded in-process 20 requests/minute IP
limiter shared with guest bootstrap/status. Exceeded limits return HTTP 429;
replays do not consume durable submission quotas. Durable IP markers use a
SHA-256 scope, not raw addresses. Old markers for an active IP are pruned on
successful submissions; inactive scopes remain in `ActionRequest` until an
approved retention cleanup is implemented.
`TRUST_PROXY=false` is the safe default. For the documented same-host reverse
proxy, set `TRUST_PROXY=loopback`, prevent direct public access to the API port,
and ensure the proxy supplies the real client address. Never blindly trust
client-supplied forwarding headers. With trust disabled behind a proxy,
clients intentionally share the proxy's IP quota.

Set the server-side `ShopSettings.coordinatorEmail` to a valid configured
recipient before accepting enquiries (otherwise HTTP 503 with no saved
submission). **Real email delivery is not implemented/enabled.** As selected
for this development scope, the existing outbox uses private local capture:
enable `OUTBOX_WORKER_ENABLED=true` only in development and set an absolute,
owner-only `OUTBOX_CAPTURE_DIRECTORY` outside any public/release directory.
With the worker disabled, notifications stay queued durably. Capture failures
remain retryable and do not invalidate a committed receipt. `received` means
stored successfully, not delivered to an external mailbox. A reviewed real
mail provider adapter is still required before production email activation.
These additions use existing tables and require no new migration.

### Admin catalogue draft reads

`GET /api/admin/catalogue` lists catalogue products with optional `q` (SSG ID,
product UUID, numeric public URL ID or BG/EN draft/current title),
`publication_status` (`draft`, `published`, `hidden`), `page` (default 1) and
`page_size` (default 24, maximum 100). Paging is stable; names come from the draft
when one exists, otherwise the current published revision.

`GET /api/admin/catalogue/:id` returns the allowlisted `AdminProduct` contract:
the optional draft and its actual revision UUID, current published revision
UUID, slug previews, verified units, distinct committed/claimed but unpromoted
staged-unit count and actionable draft validation errors. Unknown UUIDs return
404; unsupported queries return 400. These GETs never create drafts, promote
units, approve media or publish products. Read-time media checks inspect stored
metadata; they do not replace byte verification at publication.

Both endpoints require the configured development staff tokens and a live enabled staff Principal
and return `Cache-Control: private, no-store`. Public product endpoints continue
to exclude drafts. No public origin/CDN configuration is needed to read drafts.
The Postman collection includes an **Admin catalogue** folder: run **List draft
products**, copy an item UUID into `productId`, then run **Read admin product
and draft**.

For local development, the opt-in staff adapter uses the existing configured
Origin and `X-Dev-Staff-Token`/`X-CSRF-Token` headers. The same token pair authorizes
all catalogue administration and import endpoints, including publication; no
per-operation database permission grants are required. The fixed development
Principal is created automatically for audit attribution with no permissions
granted. Existing permission arrays are left untouched and ignored by these
endpoints. Disabled or non-staff Principals are still rejected on every request.
`DEV_STAFF_AUTH_ENABLED=true` is required; token authentication is rejected in
production. Production staff authentication is not provided by this adapter.

### Explicit development publication

`POST /api/admin/catalogue/:id/publish` explicitly publishes the exact current
draft. Import/commit never publishes automatically. This implementation is
**development-only and metadata-only**: it does not fetch/decode image files,
verify their hashes against storage or upload files. Enable it explicitly with
`DEV_CATALOGUE_PUBLISH_ENABLED=true`;
production rejects that setting at startup and the endpoint independently
rejects production use. Real storage verification is still required before
production publication can be enabled.

The endpoint uses the same two development staff tokens as catalogue reads and
imports, with allowed Origin and CSRF checks. No database permission grant or
SQL setup is needed.

First call `GET /api/admin/catalogue/:id`. Use its current `version` and
`draft_revision_id`, not guessed values:

```http
POST /api/admin/catalogue/<product UUID>/publish
Content-Type: application/json
Origin: <configured frontend origin>
X-Dev-Staff-Token: <development staff token>
X-CSRF-Token: <development staff CSRF token>
```

```json
{
  "request_id": "55555555-5555-4555-8555-555555555555",
  "expected_version": 2,
  "revision_id": "22222222-2222-4222-8222-222222222222"
}
```

Success returns HTTP 200 with the complete `AdminProduct`, incremented
`version`, `publication_status: "published"`, consumed `draft: null` /
`draft_revision_id: null` and the selected `published_revision_id`.
The original same-key/same-payload result replays even after the version has
changed; changed payload under the same key returns 409. Foreign, missing,
superseded or stale draft selections return 409. Unknown body/query fields
are rejected.

Both translations, applicable dictionary/composition/fulfilment fields and
change reasons must pass validation. An approved product-owned `MediaRelease`
and its selected approved images must already be attached to the draft, with
one main image first, four valid WebP derivative metadata entries and BG/EN
alt text. Metadata paths are checked using the same public projection as
product reads; **the metadata-only development flag is not evidence that the
files exist or are approved by a human**. Missing media returns 409
`MEDIA_NOT_READY`. Attach real files to an existing draft using the multipart
endpoint below, then publish separately. The backend measures file sizes/hashes.

No verified stock is needed for an enquiry-only, hidden-price catalogue
product. Purchase eligibility still uses live verified units and shop settings,
never staged import rows. Selected-locality delivery remains unavailable.
Exiting a currently published archive requires `confirm_archive_exit: true`
plus the reviewed draft change reason and nonblank note.

Publication atomically freezes the draft, supersedes the prior revision,
switches the current pointer, creates BG/EN canonical routes, appends an audit
record and queues a durable `cache_invalidate` intent. Changed title slugs
redirect old paths directly to the owner's current path; unchanged slugs do
not change routes. Historical paths cannot be reused, including when reverting
to a former title slug, under the current route immutability rules; this fails
with 409 rather than bypassing those rules. Unknown legacy first-publication
dates remain unknown; unchanged localized content retains its modification
date. Any failure rolls the entire publication back.

Public catalogue/detail/batch/search responses send `Cache-Control: no-store`,
so the FE sees committed state without relying on an external cache worker.
No cache-invalidation consumer is introduced: those outbox jobs remain pending
with the worker off or fail explicitly with the existing
`JOB_HANDLER_UNAVAILABLE` behavior if enabled without a handler.
Configure `PUBLIC_SITE_ORIGIN` and `MEDIA_CDN_BASE_URL` before publishing.
No schema migration is required.

### New-product catalogue import

#### Development multipart media attachment

`POST /api/admin/catalogue/:id/media` accepts actual image files, separately
from product import. It requires the same token pair/Origin checks,
`DEV_CATALOGUE_PUBLISH_ENABLED=true`, and a non-production environment.
Configure `AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY`, and
`AWS_S3_BUCKET_URL` (HTTPS S3 bucket URL, not a CDN URL or path prefix).
The S3 region is `eu-central-1`. `MEDIA_CDN_BASE_URL` is the public derivative
base URL; configure its storage access policy outside this application.
Credentials need scoped PutObject/DeleteObject access to the product media
prefixes. Originals under `private/products/` must not be publicly readable;
only `products/` derivatives should be readable through your CDN. The API
does not change bucket ACLs, policies or CORS.

Multipart field `metadata` contains JSON:

```json
{
  "request_id": "6d5d640b-0670-4343-8300-2c73511a3b55",
  "expected_version": 1,
  "images": [
    {
      "client_key": "front",
      "role": "main",
      "sort_order": 1,
      "alt_bg": "Предна страна на брошката",
      "alt_en": "Front of the brooch",
      "processed_with_ai": false,
      "on_model_illustrative": false
    }
  ]
}
```

For that metadata, the matching binary part must be named `image_front`.
Use one `image_<client_key>` field per image, not filenames or parallel array
positions. Do not send product ID, source URLs, derivative metadata or approval
status inside the JSON; the product UUID is in the URL. Reject unknown fields.

```bash
curl -X POST 'http://localhost:3001/api/admin/catalogue/<product UUID>/media' \
  -H 'Origin: http://localhost:3000' \
  -H 'X-Dev-Staff-Token: <staff token>' \
  -H 'X-CSRF-Token: <CSRF token>' \
  -F 'metadata=<paste the JSON above>' \
  -F 'image_front=@/absolute/path/to/brooch.jpg'
```

Do not manually set Content-Type: the multipart client supplies the boundary.
Accepts 1..5 JPEG/PNG/WebP files, up to 10 MiB each, one metadata field up to
64 KiB; decoded images are limited to 40 million pixels and one frame. The
longest source side must be at least 1600px. The backend auto-orients, strips
derivative EXIF metadata, flattens transparency onto white, and generates
square 200/400/800/1600 sRGB WebP variants using white padding without upscaling
the image content. It measures generated bytes/hashes and uploads immutable,
server-selected keys. Original bytes are stored under the private prefix.

Returns HTTP 200 `AdminProduct` with incremented version and its draft UUID.
Existing images are preserved in a new immutable release; new sort orders
must follow existing ones. Exactly one main image remains first at order 1.
At most 50 images may be selected in total. If no draft exists, it clones the
current revision including translations/composition/fulfilment into a draft.
The live pointer/status stay unchanged; publish the returned draft separately.
Matching retries (same metadata and file bytes) return the stored result without
re-upload; changed payload is 409. Concurrent/stale version changes cannot
attach to the wrong revision. A per-process processing slot bounds memory;
busy processing returns 503 and can be retried.

Uploads precede the database transaction. Known rolled-back uploads are
cleaned up; cleanup/dependency ambiguity is explicitly logged for reconciliation
and never deletes files referenced by a committed release. Crashes can leave
orphans: provision periodic S3 reconciliation/lifecycle management separately.
This is development approval, not a production human-review workflow.
S3 failures log only bounded error identifiers, HTTP status, network error code
and configured region, never the raw AWS exception, credentials or request.
For upload failures, check the code: `AccessDenied` indicates IAM/bucket policy
or KMS permissions; `InvalidAccessKeyId`/`SignatureDoesNotMatch` indicates
credentials/signing; `NoSuchBucket` indicates the bucket; `PermanentRedirect`
or `AuthorizationHeaderMalformed` may indicate a region mismatch.
No migration is required. Previously staged image imports remain committable,
but new import JSON rejects the `images` field.

Use [the full local media upload example](apps/ssg-web-api/postman/local-media-import.example.json)
with `POST /api/admin/catalogue/imports`, then commit the returned batch/SSG ID,
read the created admin product, attach actual files with the multipart endpoint,
then publish its returned version/draft UUID. Use a new request UUID for a new import.
The expanded example also includes two synthetic unit barcodes, gold/silver
composition and one legacy reference with a historical EUR price.
The fixture omits fineness codes because the current database fineness trigger
uses a different applicability format from the seeded dictionary; that existing
schema issue is not changed by media upload.
Multiple legacy IDs for one product require a separate equivalence review and are
rejected by import preflight. Units remain
unverified (`stock_status: null`, no current prices or verification dates)
and staged, not live purchasable inventory. Historical prices are not current
sale prices. Use only in a local test database; replace fixture barcodes and
legacy IDs for another import to avoid ownership conflicts.

`POST /api/admin/catalogue/imports` now accepts nested products without
client-supplied `ssg_id` values:

```json
{
  "request_id": "33333333-3333-4333-8333-333333333333",
  "data": {
    "products": [
      {
        "product_type": "jewellery",
        "jewellery_type": "brooch",
        "name_bg": "Example brooch BG",
        "name_en": "Example brooch",
        "description_bg": "Synthetic draft description BG.",
        "description_en": "Synthetic draft description.",
        "materials_state": "unknown",
        "gemstones_state": "unknown",
        "gemstone_codes": [],
        "requested_sales_mode": "enquiry_only",
        "requested_price_visibility": "hidden",
        "fulfilment_methods": [],
        "delivery_locality_ids": [],
        "pickup_location_codes": [],
        "change_reason_code": "data_check",
        "units": [],
        "materials": [],
        "legacy_links": []
      }
    ]
  }
}
```

Keep `units`, `materials` and `legacy_links` inside each product, even when empty. Their row
fields are unchanged except that `ssg_id` is removed. The previous five-sheet
request shape and explicit SSG IDs are rejected by request validation.
This corrected POST contract creates new-product drafts, not updates selected
by an existing SSG ID. Existing products/identifiers are not renamed, and
previously staged five-sheet batches can still be committed.

Preflight allocates cryptographically random uppercase hexadecimal identifiers
such as `SSG-A7F29C4E` (eight characters after the prefix), checking existing
products and staged imports and retrying collisions. IDs are durably staged,
not catalogue products yet. `products` in the response follows input order so
each generated ID can be matched to its source product. Repeating the same
actor/request ID and normalized payload returns the same batch and IDs;
changing the payload under that request ID returns 409. A new request ID
allocates new IDs and is not a retry.

Commit using the returned batch and IDs:

```json
{
  "request_id": "44444444-4444-4444-8444-444444444444",
  "ssg_ids": ["SSG-A7F29C4E"],
  "expected_product_versions": [
    { "ssg_id": "SSG-A7F29C4E", "version": null }
  ]
}
```

Send this to `POST /api/admin/catalogue/imports/<returned batch_id>/commit`;
the example ID is illustrative, not reusable. Commit continues accepting
legacy numeric SSG IDs for already staged batches. Preflight remains limited
to 1000 products, 10000 rows per related collection across the batch and
10 MB; commit accepts up to 50 products. Validation reports retain sheet/row
coordinates after flattening related arrays in product input order.
Omit `images` from new imports. Attach files through the separate multipart
endpoint; missing media still blocks publication.
No database migration is needed.

### Development outbox worker

The worker is disabled by default. To run private local capture (no external
email), set `OUTBOX_WORKER_ENABLED=true` and `OUTBOX_CAPTURE_DIRECTORY` to an
absolute directory outside the repository and public/media roots. Existing
directories must be private (owner-only permissions). Capture files contain
personal data and must never be committed or served publicly.

Run `npx nx serve ssg-web-api` to start the worker with the application.
`OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_LEASE_MS`, `OUTBOX_MAX_ATTEMPTS`,
`OUTBOX_RETRY_BASE_MS` and `OUTBOX_RETRY_MAX_MS` configure polling, leases and
bounded exponential backoff; defaults are in the application's `.env.example`.
Shutdown waits for the current iteration.

Currently, `inquiry_received` (`inquiry-v1`), `customer_payment_received`
(`payment-v1`) and `customer_order_confirmed` (`acceptance-v1`) render escaped
BG/EN HTML and plain text from stored inquiry/order/payment/acceptance snapshots.
Customer notifications only use the original order email and locale. Payment
copy does not promise acceptance; acceptance lists the exact accepted and
not-accepted subsets and subtotal, with financial clarification for partial
acceptance. Before an unsent acceptance notification, current accepted-unit
reservation conflicts suppress the message and flag `accepted_stock_conflict`
on the order. Already captured mail is reconciled before this check; sent
evidence is never retracted. A later stock fact can still race the external
capture after the final check. Atomic private capture uses the message UUID as
its idempotency key and reconciles existing captures after interrupted
attempts. `sent` means accepted by local capture, not externally delivered.

Other job kinds require registered domain handlers; until wired they fail
with `JOB_HANDLER_UNAVAILABLE`, never successful no-op dispatch. Handlers
must use immutable snapshots and idempotent processing. Email handlers must
reconcile uncertain provider acceptance before retrying; do not register a
network sender without that guarantee. No production adapter is installed,
and enabling this development worker in production is rejected.

Monitor `OutboxMessage.status/lastError/attempts` and `DeliveryAttempt` plus
the sanitized worker logs. Exhausted failures require operational review;
an expired in-flight lease remains recoverable, including the final attempt.
Failures never release inventory or change order/payment facts; an unsafe
acceptance notification only appends audited operational attention.

The stock-sale trigger correction migration fixes row-field selection when the
shared trigger runs on `StockItem` versus `StockSale`; it does not alter stock
data or remove indexes. The initial migration includes SQL-only foreign-key
indexes absent from Prisma's model metadata. Review generated migration diffs
and preserve these indexes rather than applying automatic `DROP INDEX` output.

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/getting-started/intro#learn-nx?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Run tasks

To run tasks with Nx use:

```sh
npx nx <target> <project-name>
```

For example:

```sh
npx nx build myproject
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Add new projects

While you could add new projects to your workspace manually, you might want to leverage [Nx plugins](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) and their [code generation](https://nx.dev/features/generate-code?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) feature.

To install a new plugin you can use the `nx add` command. Here's an example of adding the React plugin:
```sh
npx nx add @nx/react
```

Use the plugin's generator to create new projects. For example, to create a new React app or library:

```sh
# Generate an app
npx nx g @nx/react:app demo

# Generate a library
npx nx g @nx/react:lib some-lib
```

You can use `npx nx list` to get a list of installed plugins. Then, run `npx nx list <plugin-name>` to learn about more specific capabilities of a particular plugin. Alternatively, [install Nx Console](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) to browse plugins and generators in your IDE.

[Learn more about Nx plugins &raquo;](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) | [Browse the plugin registry &raquo;](https://nx.dev/plugin-registry?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Set up CI!

### Step 1

To connect to Nx Cloud, run the following command:

```sh
npx nx connect
```

Connecting to Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Step 2

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/getting-started/intro#learn-nx?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:
- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
