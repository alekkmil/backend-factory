---
name: implement-feature
description: Implement a complete NestJS backend feature in an existing Nx application, including REST APIs, services, DTOs, Prisma changes, validation, and error handling.
agent: agent
---

# Implement Backend Feature

You are a senior NestJS, TypeScript, Prisma 7, PostgreSQL, and Nx backend engineer.

Implement the requested feature inside an existing Backend Factory application.

Deliver complete, production-oriented functionality rather than scaffolding or placeholder implementations.

Follow all applicable repository instructions:

- `.github/copilot-instructions.md`
- `.github/instructions/nestjs-architecture.instructions.md`
- `.github/instructions/prisma-database.instructions.md`
- `.github/instructions/nestjs-api.instructions.md`
- `.github/instructions/nestjs-logging.instructions.md`
- `.github/instructions/nestjs-security.instructions.md`, if present

Do not generate automated tests unless explicitly requested.

Do not install, configure, or generate Swagger/OpenAPI functionality unless explicitly requested.

## User Request

${input:application:Target Nx application name}

${input:feature:Describe the feature to implement}

${input:requirements:Additional requirements or constraints (optional)}

## 1. Identify the Target Application

Before making changes:

1. Run `npx nx show projects`.
2. Confirm that the specified application exists.
3. Inspect the application's `project.json`.
4. Inspect its NestJS bootstrap and root module.
5. Inspect existing feature modules.
6. Inspect existing Prisma schema and configuration.
7. Inspect existing DTO, validation, logging, and security conventions.
8. Inspect reusable code in `libs/`.
9. Identify any existing implementation of the requested feature.

Never automatically select `playground-api`.

Never modify unrelated applications.

If the target application does not exist, stop and explain that it must be created first.

Do not create a new application as part of this prompt.

If the target application is ambiguous, ask for clarification before editing files.

## 2. Understand the Feature

Analyze the requested functionality before implementation.

Identify:

- Business requirements
- Required API endpoints
- Request and response contracts
- Database entities and relationships
- Business rules
- Validation requirements
- Authentication and authorization requirements
- External integrations
- Error scenarios
- Concurrency and idempotency requirements
- Existing modules that can be reused

Do not invent business rules.

Do not add functionality that was not requested.

For ambiguous requirements that materially affect security, data integrity, payments, permissions, or public API behavior, ask for clarification before implementing.

For minor implementation details, follow existing application conventions and document assumptions.

## 3. Plan the Implementation

Before editing files, provide a concise implementation plan.

The plan should identify:

1. Existing files to modify.
2. New files to create.
3. API endpoints to implement.
4. Prisma schema changes, if needed.
5. Migration requirements.
6. External dependencies, if needed.
7. Security and concurrency considerations.

Keep the plan proportional to feature complexity.

Do not stop after producing the plan unless the user explicitly requests planning only or a necessary clarification is unresolved.

Proceed with implementation.

## 4. Follow Feature-Based Architecture

Use the existing application structure.

Preferred structure for a new feature:

```text
apps/<application>/src/app/modules/<feature>/
├── dto/
│   ├── create-<feature>.dto.ts
│   ├── update-<feature>.dto.ts
│   └── <feature>-response.dto.ts
├── <feature>.controller.ts
├── <feature>.service.ts
└── <feature>.module.ts
```

Create only the files actually needed.

For larger features, add dedicated providers, adapters, repositories, interfaces, or utilities when justified.

Do not create unnecessary architectural layers.

Do not duplicate existing modules.

Do not place unrelated business logic in `AppModule` or `main.ts`.

## 5. Controller Responsibilities

Controllers must remain thin.

Controllers should:

- Define HTTP routes.
- Receive path, query, and body parameters.
- Apply DTO validation.
- Apply authentication and authorization.
- Invoke services.
- Return data matching explicit response contracts.
- Define appropriate HTTP status codes.

Controllers must not:

- Execute Prisma queries directly.
- Implement complex business logic.
- Manage database transactions.
- Call external providers directly.
- Contain unrelated functionality.

Use NestJS dependency injection.

Follow the application's existing global prefix and API versioning conventions.

Do not duplicate `/api` or `/v1` prefixes.

Do not introduce documentation-specific decorators or dependencies.

## 6. Service Responsibilities

Implement business logic inside services.

Services should:

- Enforce business rules.
- Coordinate database operations.
- Manage state transitions.
- Call existing integration providers.
- Handle expected failures.
- Return appropriate application data.
- Use existing logging infrastructure.

Keep methods focused.

Avoid large services with unrelated responsibilities.

Use constructor dependency injection.

Do not manually instantiate NestJS injectable providers.

Avoid circular dependencies.

Do not introduce `forwardRef()` as the default solution to poor module boundaries.

## 7. DTOs and Validation

Create explicit request DTOs.

Use:

- `class-validator`
- `class-transformer`

Validate all external input.

Consider:

- Required and optional properties
- String lengths
- Email and UUID formats
- Numeric ranges
- Enum values
- Nested objects
- Arrays
- Query parameters
- Date formats

Do not rely on TypeScript types for runtime validation.

Do not use Prisma models directly as request DTOs.

Use explicit response contracts for public endpoints.

Ensure actual returned data matches the declared response DTO.

Do not expose sensitive database fields.

Follow the application's existing global ValidationPipe configuration.

Do not add `@nestjs/swagger` or Swagger decorators.

## 8. Prisma 7 Database Changes

If the feature requires persistence:

1. Inspect the application's existing Prisma schema.
2. Reuse existing models where appropriate.
3. Add or modify models only when required.
4. Define relationships explicitly.
5. Add appropriate constraints and indexes.
6. Consider existing data and migration compatibility.
7. Update the application-specific Prisma Client.
8. Update services to use the generated client.

Use only the target application's Prisma schema:

`apps/<application>/prisma/schema.prisma`

Use only the target application's Prisma configuration:

`apps/<application>/prisma.config.ts`

Never modify another application's Prisma schema.

Never import another application's generated Prisma Client.

Do not introduce a shared Prisma schema.

### Migration Rules

When a schema change is needed:

- Update the Prisma schema.
- Validate the schema.
- Generate the application's Prisma Client.
- Create a named migration when a safe development database is available and its identity has been verified.
- Inspect generated migration SQL for destructive or breaking operations.
- Preserve existing migration history.

If a development database is unavailable, leave the schema changes ready and report the exact migration command.

Do not claim a migration exists unless it was actually generated.

Do not use `prisma db push` as a replacement for migration history.

Never run `prisma migrate reset` automatically.

Never run production migrations without explicit authorization.

Never perform destructive schema changes without approval.

## 9. Database Query Quality

Use Prisma efficiently.

Prefer:

- `findUnique` for unique identifiers
- `findMany` for collections
- `select` for explicit field selection
- `include` only when necessary
- Database-side filtering and sorting
- Pagination for potentially large collections
- Bulk operations where appropriate

Avoid N+1 queries.

Avoid unnecessary database round trips.

Do not fetch entire tables without a clear requirement.

Do not pass unvalidated query parameters directly into Prisma queries.

## 10. Transactions and Concurrency

Evaluate concurrency whenever the feature changes important shared state.

Examples:

- Payment processing
- Booking confirmation
- Inventory reservation
- Order fulfillment
- Subscription updates
- Webhook processing

Use Prisma transactions when multiple database operations must succeed or fail together.

Keep transactions short.

Do not make slow external API calls inside database transactions without a carefully justified design.

Use atomic conditional updates when appropriate.

Example:

```typescript
const claim = await this.prisma.booking.updateMany({
  where: {
    id: bookingId,
    status: 'OPTIONED',
  },
  data: {
    status: 'CONFIRMING',
  },
});

if (claim.count === 0) {
  return null;
}
```

This example assumes `CONFIRMING` is a valid status in the application's actual schema.

Do not introduce statuses without defining the required business transitions.

An atomic claim can prevent competing requests from entering the same transition, but it does not by itself guarantee exactly-once execution of external side effects.

For external operations, consider:

- Idempotency keys
- Durable operation states
- Recovery after process crashes
- Provider reconciliation
- Webhook deduplication
- Retry safety

Do not assume a database transaction can roll back an external API operation.

## 11. REST API Design

Use consistent REST conventions.

Prefer resource-oriented endpoints.

Example:

```text
GET    /products
GET    /products/:id
POST   /products
PATCH  /products/:id
DELETE /products/:id
```

For explicit business actions, use appropriate action endpoints.

Example:

```text
POST /bookings/:id/confirm
POST /orders/:id/cancel
```

Use appropriate HTTP status codes.

Preserve existing API versioning.

Do not invent additional endpoints.

Do not introduce breaking API changes without identifying them.

## 12. Pagination, Filtering, and Sorting

For list endpoints, implement pagination when appropriate.

Follow existing application conventions.

If none exist, prefer:

- `page`
- `limit`
- `sortBy`
- `sortOrder`

Validate query parameters.

Apply reasonable maximum page sizes.

Use allowlists for sortable fields.

Use database-side filtering and sorting.

Return a consistent pagination contract.

Use cursor pagination instead when justified by dataset size or consistency requirements.

Do not introduce pagination to endpoints that return a naturally bounded small result.

## 13. Authentication and Authorization

Inspect the application's existing authentication system.

Reuse existing guards, decorators, and authorization services.

Do not introduce a new authentication mechanism if one already exists.

For protected features:

- Require authentication where appropriate.
- Validate resource ownership.
- Enforce roles or permissions server-side.
- Do not trust user-supplied ownership fields.
- Do not expose resources belonging to other users or tenants.

Do not add authentication infrastructure unless the feature requires it.

If authorization requirements are unclear and could expose sensitive data, ask for clarification.

## 14. Error Handling

Use appropriate NestJS exceptions.

Examples:

- BadRequestException
- UnauthorizedException
- ForbiddenException
- NotFoundException
- ConflictException
- UnprocessableEntityException
- ServiceUnavailableException

Translate expected database and provider errors into meaningful application-level failures.

Do not expose raw Prisma errors.

Do not expose sensitive provider responses.

Do not convert every exception into BadRequestException.

Do not swallow errors silently.

Preserve unexpected errors for centralized logging and handling.

## 15. Logging and Request Correlation

Use the application's existing native NestJS logging infrastructure.

Preserve AsyncLocalStorage request context.

Do not create a new logger implementation inside each feature.

Use meaningful logging contexts.

Example:

```typescript
private readonly logger = new Logger(ProductsService.name);
```

Log important business events and failures.

Avoid excessive logs.

Do not log:

- Passwords
- JWT tokens
- Authorization headers
- API keys
- Database credentials
- Payment card data
- Sensitive personal information

Do not manually pass request IDs through every service unless the existing architecture explicitly requires it.

## 16. External Integrations

If the feature integrates with an external provider:

1. Inspect existing integration modules.
2. Reuse existing provider clients when possible.
3. Keep external HTTP calls outside controllers.
4. Encapsulate provider-specific logic.
5. Use validated environment configuration.
6. Handle timeouts and failures.
7. Consider retries and idempotency.
8. Avoid exposing provider-specific errors directly.
9. Preserve request correlation where appropriate.

Do not invent undocumented provider endpoints or response formats.

If required API documentation or credentials are unavailable, implement only the parts that can be completed safely and clearly report the missing dependencies.

Do not hardcode secrets.

## 17. Shared Libraries

Use existing `libs/` packages for reusable infrastructure.

Examples:

- Logging
- Authentication helpers
- Shared decorators
- External provider integrations
- General utilities

Keep application-specific business logic inside the application.

Do not extract code into a shared library merely because it might be reused someday.

Shared libraries must not import from `apps/`.

Do not modify unrelated shared libraries without a clear requirement.

## 18. Dependencies

Use npm exclusively.

Reuse existing dependencies.

Install additional packages only when required.

Use versions compatible with the current workspace.

Do not upgrade unrelated dependencies.

Do not introduce unnecessary infrastructure.

Do not add Jest, Supertest, or other automated testing dependencies unless explicitly requested.

Do not add `@nestjs/swagger` or related API documentation dependencies unless explicitly requested.

## 19. Existing Code Preservation

Prefer extending existing functionality over replacing it.

Before editing a file, understand its current responsibilities.

Preserve:

- Existing routes
- Existing business rules
- Existing DTO contracts
- Existing database constraints
- Existing logging behavior
- Existing security requirements
- Existing module exports
- Existing public APIs

Avoid broad refactoring unrelated to the feature.

Do not modify unrelated applications.

Do not overwrite user changes.

Preserve existing API documentation integrations if already present unless the user explicitly requests their removal.

## 20. Implementation Completeness

Do not stop after generating a controller or module skeleton.

Complete all applicable layers:

1. DTOs
2. Controller
3. Service
4. Module registration
5. Prisma schema changes
6. Prisma Client generation
7. Migration preparation or creation
8. Validation
9. Error handling
10. Logging integration
11. Authentication and authorization
12. Configuration changes
13. Required dependency updates

Only implement layers relevant to the requested feature.

Do not create empty placeholder services.

Do not leave TODO implementations for requirements that can be completed with the available information.

If a requirement cannot be completed, explain the blocker.

## 21. Validation

After implementation:

1. Review changed files.
2. Verify NestJS module registration.
3. Verify dependency injection.
4. Verify controller routes.
5. Verify DTO validation.
6. Verify response contracts.
7. Verify Prisma model and generated client compatibility.
8. Verify migration safety.
9. Verify authentication and authorization boundaries.
10. Verify no unrelated applications were modified.
11. Run the target application's Nx build.
12. Run lint if configured.

Run Prisma validation and generation when database changes require them.

Do not run destructive database commands.

Do not generate automated tests unless explicitly requested.

Do not claim successful validation unless commands actually ran.

## 22. Final Report

After implementation, summarize:

### Target Application

- Application name
- Feature name

### Implemented Functionality

- Business operations
- API endpoints
- DTOs
- Services and modules
- Authentication and authorization

### Database Changes

- Models created or modified
- Migrations created or pending
- Prisma Client generation status

### Files Changed

List important new and modified files.

### Validation

Report:

- Prisma validation result, if applicable
- Prisma generation result, if applicable
- Nx build result
- Lint result, if configured
- Any checks not performed

### Remaining Considerations

Explain:

- Unresolved requirements
- Required environment variables
- External provider prerequisites
- Database migration commands
- Any operational or security risks

Do not claim functionality was verified at runtime unless it actually was.

## Critical Rules

- Require an explicit target application.
- Never automatically choose playground-api.
- Do not create a new application.
- Inspect existing code before editing.
- Implement complete features, not scaffolding.
- Keep controllers thin.
- Keep business logic in services.
- Validate all external input.
- Do not introduce Swagger/OpenAPI unless explicitly requested.
- Use the application's Prisma schema and client.
- Preserve database integrity.
- Handle concurrency when required.
- Reuse existing logging and security infrastructure.
- Do not modify unrelated applications.
- Use npm exclusively.
- Do not generate automated tests unless requested.

Begin by inspecting the target application and planning the requested feature. Continue through implementation and validation unless clarification or approval is required.
