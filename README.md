# BackendFactory

## skv-web-api

The NestJS application lives in `apps/skv-web-api` and listens on port 3001
by default. Its liveness endpoint is `GET /api/health`.

Copy `apps/skv-web-api/.env.example` to `apps/skv-web-api/.env`, then start
its local PostgreSQL database (host port 5433):

```sh
docker compose -f apps/skv-web-api/docker-compose.yml --env-file apps/skv-web-api/.env up -d
npx nx serve skv-web-api
```

Use `npx nx build skv-web-api` to build. Prisma targets are
`prisma-generate`, `prisma-validate`, `prisma-migrate-dev`, and
`prisma-migrate-deploy`; for example, `npx nx run skv-web-api:prisma-generate`.
Builds generate the application-local Prisma Client automatically.
The example credentials are for local development only.

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

Run `npx nx serve skv-web-api` to start the worker with the application.
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
