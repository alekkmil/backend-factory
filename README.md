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
The [reusable workflow](.github/workflows/deploy-lightsail.yml) builds with Nx,
ships only compiled output and its generated runtime manifest/lockfile over
verified SSH, installs production dependencies on the server, applies pending
Prisma migrations, and starts/restarts the application's PM2 process.
The artifact also includes this application's schema, migration history and
Prisma config, plus a separate lockfile for the migration CLI using the
repository's installed Prisma version. No Docker, AWS access keys, or source
checkout on the server is needed.
The webpack build already generates the runtime lockfile; this workflow does
not use the separate Nx `prune` target.

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
Use `NODE_ENV=production` for safe hosted defaults even on the `dev` branch;
the development staff-auth adapter and local outbox worker are then disabled.
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

To add another application, create its own caller workflow, GitHub environment,
server directory and unique PM2 process name (derived from the application name).
Call the reusable workflow with its Nx
application name, environment, port and health path. The application must emit
`main.js`, `package.json`, and `package-lock.json` under `dist/apps/<name>` and
provide a health endpoint returning HTTP 2xx with `{"status":"ok"}`.
It must also own a Prisma config and migration directory, since the reusable
workflow runs migrations for each deployment.
Keep every application's database, secrets and process isolated.

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

Both endpoints require a live enabled staff Principal with `catalogue_read`
and return `Cache-Control: private, no-store`. Public product endpoints continue
to exclude drafts. No public origin/CDN configuration is needed to read drafts.
The Postman collection includes an **Admin catalogue** folder: run **List draft
products**, copy an item UUID into `productId`, then run **Read admin product
and draft**.

For local development, the opt-in staff adapter uses the existing configured
Origin and `X-Dev-Staff-Token`/`X-CSRF-Token` headers. Newly created development
Principals receive `catalogue_read` and `catalogue_edit`; existing permissions
are never automatically re-granted by requests. Provision `catalogue_read` for
an existing development Principal through an authorized database administration
operation if necessary. Production staff authentication remains separate and
is not provided by this development adapter.

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
