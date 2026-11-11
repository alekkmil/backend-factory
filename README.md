# BackendFactory

## ssg-web-api ###

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

   For nginx, include [the SSG upload limit snippet](tools/deploy/ssg-web-api-nginx-uploads.conf)
   inside this application's existing `server` block. It sets
   `client_max_body_size 51m`: five 10 MiB files plus up to 64 KiB metadata and
   multipart overhead. Remove any smaller override in the matching upload
   `location`; nginx uses the most specific setting. Do not change other sites.
   The proxy is server-managed; application deployment does not install this
   snippet automatically. The deployment package includes a copy; after
   deploying, run on the server:

   ```sh
   sudo install -m 644 /srv/ssg-web-api/current/ssg-web-api-nginx-uploads.conf /etc/nginx/snippets/ssg-web-api-uploads.conf
   # Add inside the existing SSG server block:
   # include /etc/nginx/snippets/ssg-web-api-uploads.conf;
   sudo nginx -t && sudo systemctl reload nginx
   ```

   An nginx HTML 413 means the request was rejected before NestJS/authentication;
   application file/count limits still apply after increasing the proxy limit.

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
| Published editorial pages and HOME assembly | `GET /api/content`, `GET /api/content/:id`, `GET /api/home` |
| Stores, site contacts and published policies | `GET /api/stores`, `GET /api/stores/:code`, `GET /api/site-contacts`, `GET /api/policies/:kind` |
| Configured consent and production SEO feed | `GET /api/cookie-config`, `GET /api/seo/urls` |

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

### Public website content, configuration and SEO

| Endpoint | Request |
| --- | --- |
| `GET /api/content` | `locale`, `type`, optional `parent_id`, `page`, `page_size` |
| `GET /api/content/:id` | Content UUID; `locale` |
| `GET /api/home` | `locale` |
| `GET /api/stores` | `locale` |
| `GET /api/stores/:code` | `sofia` or `nessebar`; `locale` |
| `GET /api/site-contacts` | `locale` |
| `GET /api/policies/:kind` | Policy kind; `locale`, optional `version` |
| `GET /api/cookie-config` | `locale` |
| `GET /api/seo/urls` | Optional `after_id`, `limit` |

Locale is `bg` or `en`. Content list responses are `{items,total,page,page_size}`;
details include resolved public sections/links, public type-specific fields,
related published products, alternate URLs and truthful publication dates.
`related_products` resolves the ordered product targets in a content record's
`related_products` links slot (falling back to the legacy product relation when
that slot is empty). `children` lists explicit `children` links first, then
published direct descendants from `parent_id` not already linked.
Only published translations and current routes are eligible. Private editorial
evidence and source JSON identifiers are not exposed as public content.
Internal targets are resolved against published entities; external links and
source media must pass the configured-origin/approved-media checks.

HOME uses the configured published HOME record, not a fabricated landing page.
Its `{locale,sections}` response preserves the source's 11 section keys and
adds `content_blocks` to each section. The HOME translation's ordered source
blocks map as follows: block 0 to `hero`, block 1 to `consultation_stores`, and
blocks 2 onward to `categories` (the current content has category copy followed
by five category images). These blocks are projected with approved media URLs;
they are separate from linked records/products/stores. `content` remains null.
HOME `primary_image` is null in `/api/content/:id`; a category image must not be
mistaken for a hero image. `/api/home` provides the mapped content directly, so
no second HOME detail request is needed.

HOME also accepts optional localized `special_data.hero_slides`, independent of
the eight existing translation blocks. `/api/home` exposes the chosen locale's
slides as `sections.find(section => section.key === "hero").slides`; absent
configuration returns `[]`. Existing `content_blocks` and all links are retained.
The frontend should render configured slides as the carousel; block 0 remains
available as shared/fallback copy, not an additional slide.

To attach two slides, add this property to the **existing** `special_data`
object of a fresh full-preservation HOME PUT (keep `kind` and `section_keys`).
Replace the copy with approved text or copy the existing block 0's `heading`
and `text`; no translation block needs to be inserted, removed or reordered:

```json
{
  "hero_slides": {
    "bg": [
      {
        "media_id": "a5949919-4673-42fc-a88e-27bf4605c19a",
        "heading": "<approved Bulgarian slide 1 heading>",
        "text": "<approved Bulgarian slide 1 text>",
        "cta": { "label": "Всички бижута", "target": { "kind": "route", "route_id": "R002" } }
      },
      {
        "media_id": "ebca9a0a-6ea5-4640-8791-8ce3cace9be0",
        "heading": "<approved Bulgarian slide 2 heading>",
        "text": "<approved Bulgarian slide 2 text>",
        "cta": { "label": "Пръстени", "target": { "kind": "route", "route_id": "R003" } }
      }
    ],
    "en": [
      {
        "media_id": "a5949919-4673-42fc-a88e-27bf4605c19a",
        "heading": "<approved English slide 1 heading>",
        "text": "<approved English slide 1 text>",
        "cta": { "label": "All jewellery", "target": { "kind": "route", "route_id": "R002" } }
      },
      {
        "media_id": "ebca9a0a-6ea5-4640-8791-8ce3cace9be0",
        "heading": "<approved English slide 2 heading>",
        "text": "<approved English slide 2 text>",
        "cta": { "label": "Rings", "target": { "kind": "route", "route_id": "R003" } }
      }
    ]
  }
}
```

Both locale arrays are required and must have equal lengths. Slide and product
counts are variable, not fixed; the existing 10 MiB JSON request-body limit
still applies. Array order is the display order. Add/remove/reorder matching
entries in both locales. A stable optional `key` identifies a slide: when keys
are supplied, every slide in both locales must have a unique key and the same
key sequence. Old slides without keys remain supported and return `key:null`.
Each slide requires an approved media UUID and `heading`, `text`, `cta`;
the last three can be null. Heading/text limits are 255/3000 characters.
A non-null CTA requires `label` and a supported `target`; public output resolves
it to `{label,url}`. Optional `product_ids` is an ordered, duplicate-free list of
published product UUIDs. Public output returns their localized ProductSummary
objects in the same order as `products`; omitted/empty lists return `[]`.
Unavailable/untranslated products reject a write rather than silently dropping
cards. Removing a slide/product reference never deletes the product or media.
Public slides return `{key,media,heading,text,cta,products}`, with localized
alt text, responsive URLs and disclosure flags inside `media`.
The UUIDs above are the existing uploaded assets, whose illustrative flag is
false. If they depict illustrative model composites, re-upload with the new
flag below and substitute the newly returned UUIDs before attaching them.

For example, `hero.content_blocks` contains the first localized HOME section;
`categories.content_blocks` contains the category copy and image blocks:

```json
{
  "key": "categories",
  "content": null,
  "content_blocks": [
    { "kind": "text", "heading": "Categories", "text": "Localized copy" },
    {
      "kind": "image",
      "media": {
        "id": "<media UUID>",
        "urls": { "default": "<CDN URL>", "w200": "<CDN URL>", "w400": "<CDN URL>", "w800": "<CDN URL>", "w1600": "<CDN URL>" },
        "width": 1600,
        "height": 1067,
        "alt": "Localized alternative text",
        "ai_disclosure_required": false,
        "on_model_illustrative": false
      },
      "caption": null
    }
  ],
  "products": [],
  "records": [],
  "stores": [],
  "links": []
}
```

Bulgarian and English HOME responses have this same structure with localized
text, alt text and URLs; link targets use their corresponding localized route.
Stores expose localized verified public data and approved media. Site contacts
resolve configured store codes and verified links; no coordinator mailbox or
other internal commerce configuration is returned. Policies return the requested
published version, or the current published version when omitted.
Cookie configuration resolves its exact published cookies-policy version.
Optional analytics/marketing providers and persistence duration must come from
approved configuration; they are never added automatically.

SEO returns `{items,next_cursor}` containing current published URLs,
alternates and nullable truthful `lastmod`. Continue with the returned cursor as
`after_id`; redirects, hidden/unpublished owners and unsupported paths are not
listed. Development returns 404 with `X-Robots-Tag: noindex, nofollow, noarchive`,
so a public development sitemap cannot be exposed accidentally.
All these endpoints validate query parameters and use no-store freshness.
Missing/invalid required source data fails explicitly; implementation does not
populate HOME, policy, contact or store content in your database on reads.

### Development website content management

All routes below use the same development-only `StaffTokenGuard` as catalogue
import: `DEV_STAFF_AUTH_ENABLED=true`, `X-Dev-Staff-Token`, `X-CSRF-Token`
and an allowed `Origin`. They reject production authentication. Saves update
the public data directly when a translation has `published: true`; no separate
publication call is required. Unpublished translations stay out of public
responses. Existing product import/media/publication endpoints remain unchanged.

| Operation | Endpoint |
| --- | --- |
| Upload, process and approve editorial/boutique images | `POST /api/admin/website/media` |
| Read/upsert a page by its stable key | `GET / PUT /api/admin/website/content/:key` |
| Read/upsert Sofia or Nessebar store details | `GET / PUT /api/admin/website/stores/:code` |
| Read/upsert both language versions of a policy | `GET / PUT /api/admin/website/policies/:kind/:version` |
| Read/update public contacts, cookie configuration or coordinator email | `GET / PATCH /api/admin/website/settings` |

Every write needs a UUID `request_id`. A matching actor/resource/request/payload
replays the original result; a changed payload under that request ID returns
409. Use a new request ID for edits. Writes are atomic and enqueue the existing
cache-invalidation outbox intent; delivery requires a configured handler.
Editorial media is separately stored from product media and requires the
`20261110140000_add_website_editorial_media` migration. Do not apply migrations
outside the normal reviewed deployment process.

Editorial upload is multipart form data, gated by the same dev staff auth and
`DEV_CATALOGUE_PUBLISH_ENABLED=true` (non-production only). Add a text part
named `metadata` containing `{"request_id":"<UUID>","images":[...]}` and one
file part named `image_<client_key>` per image. Each image entry has
`client_key`, localized `alt_bg`/`alt_en`, and `processed_with_ai`. Upload
between one and five JPEG/PNG/WebP images, each at most 10 MiB and with a
minimum 1600-pixel long edge. The API strips source metadata, generates
aspect-preserving WebP variants at 200/400/800/1600 pixels, stores the original
privately, and returns an approved `media.id` plus BG/EN public variants.
Publishing the media makes the assets usable, but does not publish a page or
store; reference the returned UUID in a published content section or store.
Use a new request ID for new bytes/metadata; approved media is immutable.
An optional per-image boolean `on_model_illustrative` defaults to false;
set it to true for illustrative model composites. `processed_with_ai: true`
sets `ai_disclosure_required: true`, independently of the illustrative flag.
Existing approved assets cannot be patched: re-upload their original files
with a new `request_id` and the correct flags, then replace their references.

#### Editable HOME slider and product cards

An editable slider fragment for `special_data` is shown below (replace the
product UUIDs with published BG/EN products). This is **not** a complete HOME
PUT: retain `kind`, `section_keys`, both translations, all eight existing blocks
and all existing ContentLinks from a fresh admin GET. Use its `updated_at` and
a new request UUID. Move the entire keyed entries in both arrays to reorder;
remove an entry from both to remove a slide; reorder `product_ids` independently
to reorder each slide's cards. Nothing depends on there being two slides or
two products:

```json
{
  "hero_slides": {
    "bg": [
      {
        "key": "collection",
        "media_id": "a5949919-4673-42fc-a88e-27bf4605c19a",
        "heading": "Колекция",
        "text": "Открийте избраните бижута.",
        "cta": null,
        "product_ids": ["37836043-8ac9-4fe7-ace6-c2cb125e1472", "2828ae48-88f1-4c08-a874-80dea5824eb0"]
      },
      {
        "key": "rings",
        "media_id": "ebca9a0a-6ea5-4640-8791-8ce3cace9be0",
        "heading": "Пръстени",
        "text": "Намерете своя пръстен.",
        "cta": { "label": "Пръстени", "target": { "kind": "route", "route_id": "R003" } },
        "product_ids": []
      }
    ],
    "en": [
      {
        "key": "collection",
        "media_id": "a5949919-4673-42fc-a88e-27bf4605c19a",
        "heading": "Collection",
        "text": "Discover selected jewellery.",
        "cta": null,
        "product_ids": ["37836043-8ac9-4fe7-ace6-c2cb125e1472", "2828ae48-88f1-4c08-a874-80dea5824eb0"]
      },
      {
        "key": "rings",
        "media_id": "ebca9a0a-6ea5-4640-8791-8ce3cace9be0",
        "heading": "Rings",
        "text": "Find your ring.",
        "cta": { "label": "Rings", "target": { "kind": "route", "route_id": "R003" } },
        "product_ids": []
      }
    ]
  }
}
```

In Postman, **Replace HOME slider preserving current content** accepts
`homeSliderJson` as the localized `{bg:[...],en:[...]}` object, fetches current
HOME, and changes only `special_data.hero_slides` in a full-preservation PUT.
Set both arrays to `[]` to remove every slide. The sample copy is illustrative,
not approved website content; existing media disclosure flags remain unchanged.

#### Editorial upload examples
For example:

```json
{
  "client_key": "hero",
  "alt_bg": "<approved Bulgarian alt text>",
  "alt_en": "<approved English alt text>",
  "processed_with_ai": true,
  "on_model_illustrative": true
}
```

Examples of references:

```json
{"kind":"image","media_id":"<media UUID>","caption":null}
```

```json
{"kind":"link_cards","items":[{"label":"Rings","text":null,"target":{"kind":"route","route_id":"R003"},"media_id":"<media UUID>"}]}
```

```json
{"media_ids":["<media UUID>"]}
```

Upload example (select an actual image at `./hero.jpg`; do not commit staff
tokens):

```sh
curl --fail-with-body --request POST "$BASE_URL/api/admin/website/media" \
  --header "Origin: $FRONTEND_ORIGIN" \
  --header "X-Dev-Staff-Token: $DEV_STAFF_AUTH_TOKEN" \
  --header "X-CSRF-Token: $DEV_STAFF_CSRF_TOKEN" \
  --form 'metadata={"request_id":"<new UUID>","images":[{"client_key":"hero","alt_bg":"<approved Bulgarian alt text>","alt_en":"<approved English alt text>","processed_with_ai":false}]}' \
  --form 'image_hero=@./hero.jpg'
```

Use the returned `assets[0].id` as the UUID in the image examples above.
The response includes `media.bg` and `media.en` projections with URLs and the
localized alt text. The same UUID can be used in a store's `media_ids`.

For page/store creation, send `expected_updated_at: null`. For edits, GET first
and pass its `updated_at` as `expected_updated_at`; stale edits return 409.
PUT replaces the entire editable record, including both BG/EN translations and
the complete ordered link array. Omitted links are removed, not merged.
GET output includes read-only fields: do not send `id`, `updated_at`, or
`replayed` back in a PUT.
Website source-validation failures return safe `details` including `field`
and `cause_code`, plus `locale`/`route_id` when available. For example a missing
category target can identify `links[33]`, locale `bg`, route `R003`, cause
`LINK_TARGET_UNAVAILABLE`. Section errors identify the translation/section
index; no content bodies, tokens, database errors or stack traces are returned.

The Postman request **Preserve HOME and add catalogue links (optional hero
slides)** fetches current HOME immediately before writing, constructs only the
editable fields, preserves both translations/all source blocks/all existing
links, and appends any missing R003-R007/R002 category links. It uses the fresh
timestamp and a new UUID. Optional environment variables `heroMediaId1` and
`heroMediaId2` add two localized slides using existing hero copy; both must be
set together. Review the intended additions before executing it.

Homepage example (`PUT /api/admin/website/content/home`):

```json
{
  "request_id": "<new UUID>",
  "expected_updated_at": null,
  "type": "home",
  "parent_id": null,
  "author_id": null,
  "special_data": {
    "kind": "home",
    "section_keys": [
      "hero", "categories", "campaigns", "selected_products",
      "engagement_wedding", "knowledge", "services", "heritage",
      "stories", "consultation_stores", "footer"
    ]
  },
  "translations": [
    {
      "locale": "bg", "path": "/", "published": true,
      "title": "SSG", "intro": null,
      "seo_title": null, "seo_description": null, "sections": []
    },
    {
      "locale": "en", "path": "/en/", "published": true,
      "title": "SSG", "intro": null,
      "seo_title": null, "seo_description": null, "sections": []
    }
  ],
  "links": [
    {
      "slot": "selected_products", "sort_order": 1,
      "target": { "kind": "product", "id": "<published product UUID>" },
      "label_bg": null, "label_en": null
    }
  ]
}
```

Then `GET /api/home?locale=en` returns the selected product summaries in the
`selected_products` section's `products` array, including live prices/media.
It also projects HOME translation blocks into `hero.content_blocks`,
`consultation_stores.content_blocks`, and `categories.content_blocks`, as
described above. Static catalogue route targets R002-R007 resolve to their
localized registered URLs without needing a database-owned `PublicRoute`.
It does not automatically select every published product. Hero/category/etc.
content can be represented by links to published content records in those
slots. The existing HOME response keeps `content: null` and exposes linked
records/products/stores/links in each section. Only one HOME record is allowed.

Other page types use the same request envelope: `hub`, `selection`, `knowledge`,
`service`, `article`, `case_study`, `press`, `author`, `guide`, `faq`, `contact`.
`type` cannot be changed after creation. `special_data.kind` must match the
type; use the existing source contract:

| Type | Additional `special_data` keys |
| --- | --- |
| `hub`, `selection` | `selector_key` (nullable string) |
| `knowledge` | `topic_code`, `gemstone_codes`, `bg`, `en`; each language object has `name`, `heading`, `lead`, exactly two `detail_paragraphs` |
| `service` | `topic_code`, `scope_bg`, `scope_en`, `enquiry_topic` |
| `article`, `case_study` | `event_at` (nullable date), `sources` (URL array), `evidence_ref` (nullable private string) |
| `press` | `publisher`, `source_url`, `source_date` (nullable date) |
| `author` | `verified_role_bg`, `verified_role_en` (nullable), `portrait_id` (nullable approved media UUID) |
| `guide` | `unit_codes` (string array) |
| `faq`, `contact` | No extra keys |

Translation `sections` accept the existing `text`, `image`, `link_cards`,
`data_table` and `faq` source JSON shapes validated by
[PublicContentService](apps/ssg-web-api/src/app/modules/public-content/public-content.service.ts).
For example: `{"kind":"text","heading":null,"text":"Confirmed plain text."}`.
Image sections reference existing approved assets:
`{"kind":"image","media_id":"<approved UUID>","caption":null}`.
No raw HTML or arbitrary/unverified media is accepted.
Content images are referenced by UUID, not uploaded through these JSON endpoints.

Link targets are exactly one of:
`{kind:"product",id}`, `{kind:"content",id}`, `{kind:"store",code}`,
`{kind:"route",route_id}`, `{kind:"external",url}`.
Related entities/media must already exist and internal link targets must
resolve publicly in both supplied locales. Parent/author references are checked;
hierarchy cycles, unavailable targets and duplicate slot/order pairs are rejected.
Create referenced pages first, then update the HOME record to link them.
The registered catalogue listing routes R002-R007 are static frontend destinations
and resolve directly; they do not represent database-published content records.
Route paths are locale-aware (`/en/...` for English), must be unoccupied,
and cannot be renamed through this endpoint: historical route identity is
immutable. Existing route ownership is never reassigned.

Store PUT uses `{request_id,expected_updated_at,public_data}`.
`public_data` requires `bg` and `en`, each with `name`, `address`,
`opening_hours` and `seasonal_note` (last two nullable), plus top-level nullable
`phone`, `email`, optional `emails` (up to five unique addresses; `email` remains
the backward-compatible primary address), `maps_url` and an approved-media
UUID array `media_ids`.
Only the existing `sofia`/`nessebar` codes are supported; no stock or sales are
created when editing a store. Public store responses include both `email`
(primary, for compatibility) and `emails` (always an array). For Nessebar,
the approved pair is `["nesebarg@ssg.bg","nesebarm@ssg.bg"]`; use the first as
the compatibility `email`. `/api/site-contacts` returns its own contact
`emails` and includes the localized store objects with their `emails` arrays.
To include Nessebar in `/api/site-contacts`, include `"nessebar"` in
`site_contacts.store_codes`.

Nessebar write fragment:

```json
{
  "email": "nesebarg@ssg.bg",
  "emails": ["nesebarg@ssg.bg", "nesebarm@ssg.bg"]
}
```

Policy PUT uses `{request_id,expected_current_version,translations}` with
exactly BG/EN entries `{locale,title,text,url}`. `url` is the absolute public
website URL, not the API URL; it must use the configured website origin,
the correct locale path (`/en/...` for English), and no query or fragment.
`expected_current_version` is null for initial
creation or the current version label for replacement. Saving makes both
translations published/current and retains older versions as non-current.
Policy text/identity is immutable even before publication: edits require a
new version label. Matching text on an existing version can be upserted.
When replacing the current cookies policy, an existing configured
`cookie_config.policy_version` is advanced atomically and the settings version
increases; both language policy versions are created together.
Public policy URLs (including HOME/FAQ links, cookie configuration and SEO
alternates) use `PUBLIC_SITE_ORIGIN` and the registered path for that policy
kind/locale. A stored historical HTTP(S) origin does not require changing
immutable policy text or accepted versions. The stored path must still match
the registered policy route; malformed URLs, credentials, query strings,
fragments and wrong kind/locale paths are rejected. New policy writes still
require the current configured origin.

Settings PATCH requires `{request_id,expected_version}` and at least one of
`site_contacts`, `cookie_config`, `coordinator_email` (nullable).
GET returns the current `version`; stale updates return 409.
It cannot change currency, purchasing allowlists, prices or `ready`, and
requires an existing `ShopSettings` row.
`site_contacts` contains nullable `phone`/`email`, optional `emails` (up to
five; the first must match `email` when both are supplied), `store_codes` and
`verified_links` (`label_bg`, `label_en`, `url`).
`cookie_config` contains `version`, `policy_version`, `necessary_enabled:true`,
`optional_categories`, `providers` and nullable `persistence_days`.
Each provider requires `id`, `category` (`analytics`/`marketing`), `name`,
`purpose_bg`, `purpose_en`. Save the matching published cookies policies before
configuring cookies. These writes do not invent consent choices or policy text.

### Catalogue draft editing, visibility and reviewed-media registration

| Operation | Endpoint |
| --- | --- |
| Replace the editable draft without releasing it | `PATCH /api/admin/catalogue/:id/draft` |
| Read the current report of an actor-owned import batch | `GET /api/admin/catalogue/imports/:id` |
| Hide or restore a previously published product | `POST /api/admin/catalogue/:id/visibility` |
| Register already-processed image metadata | `POST /api/admin/catalogue/:id/media-releases` |

These use the same development staff/Origin/CSRF guard as catalogue reads.
Draft save requires `{request_id,expected_version,draft,confirm_archive_exit?}`:
`draft` is a full replacement using the admin detail draft fields, including
nullable values and empty arrays. It validates dictionaries/composition,
fulfilment, product-owned approved image selections, and restriction reasons.
It returns the complete `AdminProduct`, creating a draft from the released
revision when needed. Saving never changes live routes or publishes.
Archive exit requires explicit `confirm_archive_exit:true` plus a reviewed reason
and note; verification of a barcode alone is not archive-exit authority.

### Structured jewellery specifications

`PATCH /api/admin/catalogue/:id/draft` additionally accepts
`draft.specifications`. Specifications belong to the revision, not physical
stock units. The additive `20261111110000_add_jewellery_specifications`
migration adds nullable JSONB storage, published-revision immutability and
starter BG/EN dictionary entries. Deploy it through the reviewed migration flow.
No existing product, stock measurement or website content is backfilled.

- `weight_g` is the overall product weight, not a sum inferred from components.
  Each component can separately carry its own `weight_g`.
- `materials` and `stone_groups` are ordered, repeatable arrays. Each stone's
  type, weight, colour, grade, clarity and shape stay on the same object.
- `components` have unique stable `key`, `name_bg`, `name_en` and all the same
  piece-level fields (but no nested components). Use them for women's/men's
  bands, earrings or other set pieces.
- Missing scalar values become `null`, never zero. Decimal measurements are
  positive JSON strings: grams allow three decimal places, carats four.
  Null means unknown; no component weights or carats are automatically summed.
- `pearl_type_codes`, `finish_codes`, `construction_detail_codes` are repeatable
  dictionary references. Optional `construction_details_bg/en` hold additional
  localized plain text.
- Omit the whole `specifications` field to preserve it on an existing/cloned
  draft; send `null` to clear it. A supplied object replaces its entire structured
  specification, including components. Other legacy draft fields still use the
  existing full-replacement contract.
- Existing top-level legacy `materials`/`gemstone_codes` and composition states
  remain unchanged for backwards compatibility. Catalogue filters/facets use
  the union of legacy and structured material/stone codes.

Read dictionary choices with `GET /api/dictionaries?locale=bg` and `locale=en`.
Groups are `material`, `material_colour`, `gold_karat`, `fineness`, `gemstone`,
`stone_colour`, `stone_grade`, `stone_clarity`, `stone_shape`, `pearl_type`,
`finish`, `construction_detail`. Codes are case-sensitive; only active existing
codes are accepted, with `applies_to` checked where the parent material/stone
is known. The migration adds starter choices, not an exhaustive vocabulary.
The existing dictionary maintenance mechanism can add more choices.

Complete draft-save example (replace the product URL, `expected_version` and
request UUID with current values). For an existing draft, copy its current
fields, image UUIDs and fulfilment configuration instead of replacing them
with the empty selections below. This example saves an incomplete enquiry-only
draft; attaching approved product media and explicit publication remain separate:

```json
{
  "request_id": "c1ff9866-c746-49f1-933a-25c3a251cf34",
  "expected_version": 1,
  "draft": {
    "product_type": "jewellery",
    "jewellery_type": "ring",
    "name_bg": "Комплект брачни халки",
    "name_en": "Wedding band set",
    "description_bg": "Описание на комплекта.",
    "description_en": "Description of the set.",
    "materials_state": "unknown",
    "materials": [],
    "gemstones_state": "unknown",
    "gemstone_codes": [],
    "sales_mode": "enquiry_only",
    "price_visibility": "hidden",
    "fulfilment_methods": [],
    "delivery_scope": null,
    "delivery_locality_ids": [],
    "pickup_location_codes": [],
    "media_release_id": null,
    "image_ids": [],
    "change_reason_code": null,
    "change_reason_note": null,
    "specifications": {
      "weight_g": "10.250",
      "materials": [],
      "stone_groups": [],
      "pearl_type_codes": [],
      "finish_codes": [],
      "construction_detail_codes": [],
      "components": [
        {
          "key": "womens_band",
          "name_bg": "Дамска халка",
          "name_en": "Women's band",
          "weight_g": "4.125",
          "materials": [
            { "material_code": "gold", "colour_code": "white", "gold_karat_code": "18", "fineness_code": "gold_750" },
            { "material_code": "gold", "colour_code": "rose", "gold_karat_code": "18", "fineness_code": "gold_750" }
          ],
          "stone_groups": [
            { "stone_code": "diamond", "carat_weight": "0.2500", "colour_code": "colourless", "grade_code": "G", "clarity_code": "VS1", "shape_code": "round" },
            { "stone_code": "sapphire", "carat_weight": null, "colour_code": "blue", "grade_code": null, "clarity_code": null, "shape_code": "oval" }
          ],
          "pearl_type_codes": [],
          "finish_codes": ["polished"],
          "construction_detail_codes": ["solid"],
          "construction_details_bg": "Двуцветна халка.",
          "construction_details_en": "Two-tone band."
        },
        {
          "key": "mens_band",
          "name_bg": "Мъжка халка",
          "name_en": "Men's band",
          "weight_g": null,
          "materials": [
            { "material_code": "gold", "colour_code": "white", "gold_karat_code": "18", "fineness_code": "gold_750" }
          ],
          "stone_groups": [],
          "pearl_type_codes": [],
          "finish_codes": ["brushed"],
          "construction_detail_codes": [],
          "construction_details_bg": null,
          "construction_details_en": null
        }
      ]
    }
  }
}
```

For pearl jewellery, for example set `pearl_type_codes:["akoya"]` on the product
or the relevant component. Measurements and all other fields may remain unknown.
The Postman draft-save request also accepts this full contract in `draftJson`.

Public product detail, catalogue, product-batch, related-product and HOME slider
product summaries include localized `specifications`. Dictionary references
project to `{code,label}` objects (`material`, `colour`, `fineness`, `gold_karat`,
`stone`, `grade`, `clarity`, `shape`); components return localized `name`.
Measurements remain decimal strings/null; `construction_details` is localized.
Old products return `specifications:null`. Saving drafts never changes these
public responses until the normal publish endpoint succeeds.

Catalogue and search accept a URL-encoded JSON `specification_filter`. For
example, the following catalogue filter requires **one diamond group** with
VS1 clarity and 0.1-0.5 carats on the women's band; it cannot combine the type
from one group with the clarity/weight of another:

```sh
curl --get "$BASE_URL/api/catalog" \
  --data-urlencode 'locale=en' \
  --data-urlencode 'specification_filter={"component_key":"womens_band","stone":{"stone_code":"diamond","clarity_code":"VS1","carat_min":"0.1","carat_max":"0.5"}}'
```

Supported filter fields: `weight_g_min/max` (overall product weight only),
`component_key`, `material` (any material-entry code fields), `stone` (any
stone-group fields plus `carat_min/max`), `pearl_type_codes`, `finish_codes`,
`construction_detail_codes`. Min/max are inclusive and unknown measurements
do not match a range. Material constraints match one material entry; stone
constraints match one group. When both are supplied they must match the same
piece. Arrays use OR within the field and AND across fields.
Existing `material_codes`/`gemstone_codes` still match any component and appear
in catalogue facets alongside the new specification dictionary groups.

`GET /api/search?locale=en&q=...` also matches localized specification labels,
codes, component names, measurements and construction text. Supply the same
`specification_filter` to constrain its product results; content results remain
independent. Empty search queries retain their existing empty-result behavior.

Visibility body: `{request_id,expected_version,publication_status,reason,note}`.
The requested status is `hidden` or `published`, never `draft`.
Restoration requires an existing released current revision, valid current routes
and publication-ready media. Visibility writes also require
`DEV_CATALOGUE_PUBLISH_ENABLED=true`; production use remains disabled.
Hiding preserves editorial data and URL history while excluding the product
from public reads. It is not deletion or a draft publication operation.

Media registration body: `{request_id,version,receipt_sha256,images}`.
Version is `v` plus a positive integer; the receipt is 64 lowercase hex characters.
Each image requires `logical_image_id`, `role`, `original_relative_path`,
`alt_bg`, `alt_en`, `processed_with_ai`, `on_model_illustrative`, and exactly
four square 200/400/800/1600 WebP/sRGB `derivatives` with object key, dimensions,
byte count and SHA-256. Legacy registration paths are
`SSG-ID_org/IMAGE_ID.jpg` and `products/SSG-ID/vN/IMAGE_ID-SIZE.webp`;
the multipart upload endpoint retains its product UUID/release UUID paths.
Both formats use the existing public media projection.
Success returns `{release_id,approved,assets:[{id,logical_image_id}]}` (201 first,
200 replay). Registration does not attach the release: select its release/asset
IDs in draft save, then publish explicitly.

**Registration approval is development metadata-only**, behind
`DEV_CATALOGUE_PUBLISH_ENABLED`. Reviewer attribution and the supplied receipt
hash are stored, but no receipt artifact/signature or storage bytes are verified;
the audit explicitly records that limitation. It does not establish authentic
human review or production-ready storage. Prefer multipart upload when the
backend should actually process and upload image files.
Matching write retries return original results; changed payloads and stale
versions conflict. Unknown body/query properties are rejected.

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

### Verified inventory and restricted stock facts

| Operation | Endpoint |
| --- | --- |
| Promote a committed import barcode into a verified physical unit | `POST /api/admin/catalogue/staged-units/promote` |
| Replace verified price/measurement facts only | `PATCH /api/admin/stock/:stock_item_id/details` |
| Record documented physical absence | `POST /internal/stock/:stock_item_id/physical-absence` |
| Record a documented actual store sale | `POST /internal/stock/:stock_item_id/store-sale` |

Admin operations use the existing opt-in development staff token/Origin/CSRF
guard. Promotion requires a committed batch row containing the genuine barcode,
matching `BarcodeIdentity` ownership and no existing operational `StockItem`.
It never overwrites existing stock, exits archive mode or publishes a product.
Original staging payloads remain immutable; admin staged counts are derived from
whether each claimed barcode now has a verified unit.

Promotion body (synthetic shape; replace all identifiers and facts with verified
data before use):

```json
{
  "request_id": "<stable request UUID>",
  "batch_id": "<committed import UUID>",
  "ssg_id": "<returned SSG ID>",
  "barcode": "<genuine imported barcode>",
  "location_code": "sofia",
  "stock_status": "available",
  "price": null,
  "currency": null,
  "weight_g": null,
  "stone_weight_ct": null,
  "dimensions_mm": null,
  "verified_at": "<actual verification ISO timestamp>",
  "source_ref": "<verification evidence reference>",
  "transfer_to": null,
  "reservation_reference": null,
  "sale": null
}
```

All keys above are required, including nullable keys. Price/currency must both
be null or a positive decimal string and ISO currency code. Measurements must
be positive decimal strings; dimensions accept only `length`, `width`, `height`,
`inner_diameter`, `circumference`. Embedded gemstone weight is not accepted as
`stone_weight_ct` for jewellery. Verification/sale timestamps cannot be future.
`reserved` requires `reservation_reference`; `in_transit` requires a different
`transfer_to` store; other statuses forbid those respective fields.
`sold` requires `sale` with `channel`, nullable `store_location`, `document_ref`,
`sold_at`, positive `amount`, `currency` and nullable `seller_provenance`.
Store sales require a store; historical online sales use a null store.
Promotion returns `stock_item_id`, `product_id`, `barcode`, `status`, `replayed`;
first creation is 201 and matching replay is 200.

Unit details uses `request_id`, `expected_version`, all nullable price/fact
fields shown above, `verified_at`, `source_ref`, `reason` and `note`.
It cannot change barcode, product, status, location, reservation or sale history.
Its response is `{stock_item_id, version, price, facts}`. Existing quote/order
snapshots and actual sale amounts remain unchanged.

The `/internal/stock` routes are **not registered in production**. In development,
they use the same `StaffTokenGuard` as import, commit, promotion and publication:
enable `DEV_STAFF_AUTH_ENABLED` and send `X-Dev-Staff-Token`, `X-CSRF-Token`
and an allowed `Origin`. The authenticated, enabled staff principal is recorded
as the actor; no service principal or `stock_fact_write` grant is needed for
these development HTTP routes. The former `DEV_STOCK_FACT_AUTH_*`,
`DEV_STOCK_FACT_CSRF_TOKEN`, `DEV_STOCK_FACT_PRINCIPAL_ID` and
`X-Dev-Stock-Token` are no longer used.
`STOCK_FACT_SOURCE_CODE` is optional for development staff and defaults to
`dev-staff-stock`; keep any existing configured source identifier unchanged
to preserve source-event deduplication across the authentication change.
Non-HTTP service callers still require an enabled service principal with
`stock_fact_write` and a configured source identifier.
Keep these internal routes restricted by deployment networking.

Absence body: `{request_id, expected_version, source_event_id, evidence_ref,
reason, note}`. Sale body: `{request_id, expected_version, source_event_id,
store_code, document_ref, sold_at, amount, currency, seller_provenance?}`.
Both return `{stock_item_id, version, status, fact_event_id, replayed}`.
Actor request keys and trusted source events are independently deduplicated;
changed facts under the same key conflict. A genuine sale with an old observed
version is reconciled against current stock rather than discarded; contradictory
sale evidence returns 409.

Stock facts update affected checks/order attention in the same transaction,
retain acceptance history and suppress unsafe unleased acceptance notifications.
In-flight notifications retain the existing final stock recheck and uncertain
delivery reconciliation behavior. Absence blocks unsold stock; it never records
a sale. All actual units sold triggers commercial-only autoarchive, preserving
visibility, routes, original dates, media, text and any separate editorial draft.
No-current products remain unpublished. Product versions increase on factual
writes; public lastmod and invalidation change only for changed public output.
No automatic transfer/release or general stock lifecycle UI is added.

The non-destructive
`20261107114000_allow_incomplete_drafts_and_hidden_revisions` migration permits
incomplete jewellery drafts and commercial replacement of a hidden current
revision. It replaces the immediate single-draft index with an equivalent
deferred exclusion constraint: a commercial revision can assemble its children
within the transaction while a separate editorial draft is retained, but only
one draft may exist at commit. Released jewellery still requires a valid type and complete approved
media/translations. Deferred pointer/revision checks validate the final row state,
not intermediate snapshots while a commercial revision is assembled.
Only `publicModifiedAt` may change on a current public translation; published
text, identity, original dates and evidence remain immutable.
Apply the migration on deployment; it was verified only on
an isolated database, not on your configured local or Lightsail database.

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
