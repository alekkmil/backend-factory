---
name: create-nestjs-app
description: Create a complete, independent NestJS backend application in the Backend Factory Nx monorepo.
agent: agent
---

# Create NestJS Application

You are a senior NestJS, Nx, TypeScript, Prisma, and PostgreSQL engineer.

Create a new production-oriented NestJS application inside this Backend Factory monorepo.

The application must follow all repository instructions, especially:

- `.github/copilot-instructions.md`
- `.github/instructions/nestjs-architecture.instructions.md`
- `.github/instructions/prisma-database.instructions.md`
- `.github/instructions/nestjs-api.instructions.md`
- `.github/instructions/nestjs-logging.instructions.md`
- `.github/instructions/nestjs-security.instructions.md`, if present

Do not generate automated tests unless explicitly requested.

Do not install or configure Swagger/OpenAPI unless explicitly requested.

## User Request

$ARGUMENTS

## 1. Determine the Application

Extract the following from the user's request:

- Application name
- Application purpose
- Initial business features, if any
- Database requirements, if different from the default
- External integrations, if explicitly requested

If the application name is missing, ask the user for it before proceeding.

Do not invent initial business features.

Use PostgreSQL and Prisma 7 by default.

Never automatically choose `playground-api`.

Do not overwrite an existing application.

## 2. Inspect the Workspace

Before making changes:

1. Read `package.json`.
2. Read `nx.json`.
3. Inspect installed Nx and NestJS plugins.
4. Run `npx nx show projects`.
5. Inspect the structure of existing NestJS applications.
6. Inspect existing Prisma integration.
7. Inspect available shared libraries.
8. Inspect existing application configuration and logging.
9. Read applicable Copilot instruction files.
10. Identify the correct Nx generator and its supported options.

Use npm exclusively.

Do not use pnpm or yarn.

Do not reinstall packages that already exist.

Do not modify unrelated applications.

Do not guess Nx generator flags. Inspect generator help or schema when necessary.

## 3. Generate the Application

Create the new NestJS application using the installed Nx NestJS generator.

Prefer the installed `@nx/nest:application` generator when available.

Use the naming and directory conventions already established in the workspace.

Target structure:

```text
apps/<app-name>/
├── src/
│   ├── main.ts
│   ├── generated/
│   │   └── prisma/
│   └── app/
│       ├── app.module.ts
│       ├── config/
│       ├── common/
│       │   └── logging/
│       ├── database/
│       │   ├── prisma.module.ts
│       │   └── prisma.service.ts
│       └── modules/
│           └── health/
│               ├── health.controller.ts
│               └── health.module.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── prisma.config.ts
├── .env.example
├── project.json
└── tsconfig.app.json
```

This is a target structure, not a requirement to create unused directories.

Adapt to the existing workspace conventions.

Do not create placeholder business modules.

Remove generator-created example functionality that is not needed.

Do not create or retain Jest, Supertest, `*.spec.ts`, or `*.e2e-spec.ts` files unless explicitly requested.

Do not delete existing test infrastructure belonging to other applications.

## 4. Configure NestJS

Configure the application with:

- NestJS and TypeScript
- Dependency injection
- Global API prefix
- Global DTO validation
- Environment configuration
- Native NestJS logging
- Request correlation IDs
- A health endpoint

Use the installed NestJS version's supported APIs.

Keep `main.ts` focused on bootstrap.

Do not place business logic in `main.ts`.

Do not install `@nestjs/swagger`.

Do not generate API documentation endpoints or specifications by default.

## 5. Application Environment Configuration

Each application must own its environment configuration.

Create:

```text
apps/<app-name>/.env.example
```

Use application-specific values such as:

```dotenv
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://postgres:password@localhost:5432/<app_name>_db
CORS_ORIGINS=http://localhost:3000
```

Replace example values with sensible defaults for the new application.

Do not commit actual secrets.

Ensure local development loads the target application's `.env`.

Use `@nestjs/config` or the repository's existing configuration approach.

Validate required environment variables.

Do not accidentally load `playground-api` environment values.

Do not assume every application uses the same port.

If the requested port conflicts with an existing application, select an unused development port and document the choice.

Do not silently use production credentials.

## 6. Configure Prisma 7

Each application must own:

- `prisma/schema.prisma`
- `prisma.config.ts`
- `prisma/migrations/`
- Generated Prisma Client
- PrismaService
- PrismaModule
- Database connection configuration

Use Prisma ORM v7 conventions.

Prefer the `prisma-client` generator with an explicit application-local output directory.

Example:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

Configure the database connection through the application's `prisma.config.ts`.

Use the PostgreSQL driver adapter:

- `@prisma/adapter-pg`
- `pg`

Import PrismaClient from the generated application-specific output.

Do not import a Prisma Client belonging to another application.

Do not introduce a root-level shared Prisma schema.

Do not invent business models.

Do not run migrations against an existing database without verifying the target.

Do not automatically reset databases.

## 7. PrismaService

Create an application-specific PrismaService.

Requirements:

- Extend the generated PrismaClient when compatible with the configured generator.
- Use PrismaPg.
- Use the application's validated database connection string.
- Register PrismaService through PrismaModule.
- Provide a shared PrismaService instance within the application.
- Disconnect gracefully during application shutdown.
- Avoid creating database connections per request.
- Do not expose PrismaService directly through controllers.

Use the repository's existing implementation if one already exists and is appropriate.

## 8. Nx Prisma Targets

Configure application-specific Nx targets for:

- `prisma-generate`
- `prisma-validate`
- `prisma-migrate-dev`
- `prisma-migrate-deploy`

Each command must explicitly target:

```text
apps/<app-name>/prisma.config.ts
```

Use the installed Nx configuration format.

Merge targets into the generated application configuration.

Do not overwrite unrelated targets.

Ensure the application build runs after Prisma Client generation when required.

Do not automatically run migrations on every application startup.

Do not automatically deploy migrations during local development.

## 9. Global Validation

Configure global ValidationPipe.

Recommended configuration:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
  }),
);
```

Use explicit DTO validation for future features.

Do not introduce unnecessary DTOs into the initial application.

## 10. Health Endpoint

Create a minimal health module.

Recommended endpoint:

```text
GET /api/health
```

Recommended response:

```json
{
  "status": "ok"
}
```

Keep the initial health endpoint lightweight.

Do not require a database query for a basic liveness check.

If the user explicitly requests a readiness endpoint, it may check database connectivity and required dependencies separately.

Do not introduce unnecessary monitoring libraries.

## 11. Request-Aware Logging

Use native NestJS logging and Node.js AsyncLocalStorage.

Reuse existing logging infrastructure from `libs/` if available.

Otherwise, create the minimum application-local logging infrastructure required.

Requirements:

1. Generate a unique request ID for every HTTP request.
2. Use `crypto.randomUUID()`.
3. Store request context using AsyncLocalStorage.
4. Preserve isolation across concurrent requests.
5. Expose `X-Request-ID` in the response.
6. Log HTTP method, safe route/path, status, and duration.
7. Integrate correlation into the application's configured NestJS logger.
8. Preserve logging context, metadata, and error stacks.
9. Support logging outside HTTP requests.
10. Avoid sensitive data in logs.

Use NestJS 11-compatible middleware route patterns.

Do not use legacy wildcard routes that trigger warnings.

Prefer JSON logging in production when supported by the installed NestJS version.

Do not introduce Winston or Pino unless explicitly requested.

Do not assume that merely creating an injectable logger automatically makes existing NestJS Logger instances request-aware.

Ensure the logger is actually integrated with the NestJS logging system.

## 12. Security Defaults

Use safe defaults.

Configure CORS from environment configuration.

Do not use unrestricted production CORS unless explicitly requested.

Do not log secrets.

Do not expose stack traces in production responses.

Use appropriate HTTP error handling.

Do not add JWT authentication, user accounts, role management, or authorization infrastructure unless requested.

Do not add rate limiting or other infrastructure without assessing the application's requirements.

## 13. Application Isolation

The new application must be independently runnable and deployable.

It must not depend on another application's:

- `.env`
- Prisma schema
- Prisma Client
- Database connection
- Business modules
- Bootstrap configuration
- Deployment configuration

Shared infrastructure may be imported from `libs/`.

Shared libraries must not import from `apps/`.

Do not modify another application merely to make the new one work.

## 14. Dependency Management

Use existing workspace dependencies when possible.

Install missing dependencies with npm.

Use versions compatible with the installed NestJS, Nx, Node.js, and Prisma versions.

Do not blindly upgrade unrelated dependencies.

Do not add packages for functionality that can be implemented with native NestJS or Node.js APIs.

Do not add testing dependencies.

## 15. Validate the Generated Application

After implementation:

1. Run Prisma schema validation.
2. Generate Prisma Client.
3. Verify TypeScript imports.
4. Verify dependency injection registration.
5. Run the application's Nx build.
6. Run lint if configured.
7. Check the application is discoverable by Nx.
8. Verify no unrelated applications were modified.

If a safe local runtime environment is available, start the application and verify:

- Health endpoint
- Request ID response header
- Request-aware logging

Do not run destructive database commands.

Do not assume PostgreSQL is running.

Do not claim runtime verification unless it actually occurred.

Do not generate automated tests unless explicitly requested.

## 16. Final Report

After creating the application, provide:

### Application

- Name
- Directory
- Nx project name
- Development port

### Infrastructure

- Prisma schema location
- Prisma configuration location
- Generated Prisma Client location
- Environment configuration
- Logging implementation
- Health endpoint

### Commands

Provide exact npm/Nx commands for:

- Prisma Client generation
- Prisma schema validation
- Creating development migrations
- Starting the application
- Building the application

### Validation

Report which commands succeeded and which were not executed.

Explain any missing configuration or prerequisites.

### Important Rules

- Never overwrite an existing application.
- Never automatically select playground-api.
- Use npm exclusively.
- Use installed Nx generators.
- Use Prisma 7 conventions.
- Keep every application database-independent.
- Reuse existing logging infrastructure.
- Do not install Swagger/OpenAPI unless requested.
- Generate no business features unless requested.
- Generate no automated tests unless requested.
- Never run destructive migrations without approval.
- Never claim validation succeeded without running it.

Begin by inspecting the workspace and identifying the requested application name.
