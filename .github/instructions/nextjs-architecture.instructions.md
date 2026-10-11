---
applyTo: "apps/**/*.ts,libs/**/*.ts"
description: "NestJS architecture, feature modules, controllers, services, dependency injection, and application isolation rules"
---

# NestJS Architecture Instructions

You are a senior NestJS backend architect working in an Nx monorepo containing multiple independently deployable backend applications.

Follow these instructions when creating or modifying NestJS application code.

Prioritize clean architecture, maintainability, security, scalability, and consistency with existing application conventions.

Do not generate automated tests unless explicitly requested.

Do not install or configure Swagger/OpenAPI unless explicitly requested.

## 1. Inspect Before Implementation

Before modifying code:

1. Read `.github/copilot-instructions.md`.
2. Identify the target NestJS application.
3. Inspect its existing folder structure.
4. Inspect its root module and bootstrap configuration.
5. Identify relevant feature modules, services, DTOs, and shared libraries.
6. Understand the existing dependency injection patterns.
7. Inspect existing Prisma integration when database access is required.
8. Reuse existing architecture and naming conventions.

Do not restructure an existing application without a clear requirement.

Do not modify unrelated applications.

Do not automatically select `playground-api`.

## 2. Application Structure

Use feature-based modular architecture.

Prefer the following structure for new applications:

```text
apps/<application-name>/
├── src/
│   ├── main.ts
│   └── app/
│       ├── app.module.ts
│       ├── modules/
│       │   ├── users/
│       │   │   ├── dto/
│       │   │   │   ├── create-user.dto.ts
│       │   │   │   ├── update-user.dto.ts
│       │   │   │   └── user-response.dto.ts
│       │   │   ├── users.controller.ts
│       │   │   ├── users.service.ts
│       │   │   └── users.module.ts
│       │   └── orders/
│       │       ├── dto/
│       │       ├── orders.controller.ts
│       │       ├── orders.service.ts
│       │       └── orders.module.ts
│       ├── database/
│       │   ├── prisma.module.ts
│       │   └── prisma.service.ts
│       ├── common/
│       │   ├── filters/
│       │   ├── interceptors/
│       │   ├── decorators/
│       │   ├── guards/
│       │   └── logging/
│       └── config/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── prisma.config.ts
├── .env.example
└── project.json
```

Only create folders and files that are actually required.

Follow the application's existing structure if it differs.

Do not introduce architectural changes unrelated to the requested feature.

## 3. Feature Module Architecture

Organize business functionality into cohesive NestJS modules.

Examples:

- UsersModule
- OrdersModule
- ProductsModule
- PaymentsModule
- BookingsModule

Each feature module should encapsulate its own functionality.

A typical feature contains:

- Controller for HTTP endpoints
- Service for business logic
- Module for dependency injection
- DTOs for request validation and response contracts

Add repositories, adapters, interfaces, utilities, or additional services only when justified.

Do not create unnecessary architectural layers for simple CRUD features.

### Example

```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

Export `UsersService` only if another module needs it.

Avoid exporting providers unnecessarily.

## 4. Controller Responsibilities

Controllers handle the HTTP transport layer.

Controllers may:

- Define routes
- Receive path parameters
- Receive query parameters
- Receive request bodies
- Apply validation
- Apply authentication and authorization
- Call services
- Return appropriate response DTOs
- Define HTTP status codes

Controllers must not:

- Contain complex business logic
- Execute Prisma queries directly
- Implement payment processing
- Call external APIs directly
- Contain database transactions
- Implement unrelated functionality

### Example

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
}
```

Keep controllers thin.

Validate route parameters using appropriate pipes or DTOs.

## 5. Service Responsibilities

Services implement business logic and coordinate operations.

Services may:

- Enforce business rules
- Query the database
- Execute transactions
- Call external provider services
- Coordinate multiple modules
- Transform internal data
- Handle domain-specific failures
- Implement state transitions

Services should be focused on a coherent responsibility.

Avoid large services containing unrelated functionality.

Extract dedicated services when complexity justifies it.

### Example

```typescript
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
```

This is an architectural example only.

Use explicit response DTOs when exposing public API contracts.

Do not expose sensitive database fields.

## 6. Dependency Injection

Use NestJS dependency injection consistently.

Prefer constructor injection.

Register providers in the correct module.

Export providers only when needed outside their module.

Import the providing module instead of redeclaring the same provider.

Avoid manually constructing injectable services with `new`.

Do not introduce circular dependencies.

Avoid `forwardRef()` unless there is a justified architectural reason.

Prefer extracting shared functionality or restructuring module dependencies.

Do not use global modules unnecessarily.

Global modules are acceptable for genuinely cross-cutting infrastructure when consistent with the application architecture.

## 7. DTO Architecture

Use DTO classes for HTTP input validation.

Organize DTOs inside their feature modules.

Prefer:

```text
users/
└── dto/
    ├── create-user.dto.ts
    ├── update-user.dto.ts
    ├── list-users-query.dto.ts
    └── user-response.dto.ts
```

Use:

- `class-validator`
- `class-transformer`

Validate required fields, types, lengths, ranges, and formats.

Do not trust client-provided values.

Use explicit response DTOs when public API contracts require them.

Do not expose internal or sensitive database fields.

Do not use Prisma models as request DTOs.

Avoid duplicating DTOs unnecessarily.

Do not add documentation-specific decorators or dependencies unless explicitly requested.

## 8. Prisma Integration

Each application owns its Prisma configuration and generated Prisma Client.

Prisma integration should be provided through an application-specific PrismaService and PrismaModule, or an existing equivalent.

Feature services may inject PrismaService.

Controllers must not access PrismaService directly.

Do not import another application's Prisma Client.

Do not assume shared libraries have access to application-specific database models.

Use transactions when multiple database operations must be atomic.

Handle database errors appropriately.

Do not introduce repository abstractions solely to wrap every Prisma method.

Introduce repositories when they provide meaningful value, such as complex reusable queries or domain isolation.

## 9. Error Handling

Use NestJS built-in HTTP exceptions when appropriate.

Examples:

- BadRequestException
- UnauthorizedException
- ForbiddenException
- NotFoundException
- ConflictException
- UnprocessableEntityException

Map expected domain and persistence failures to appropriate HTTP responses.

Do not expose internal implementation details.

Do not silently swallow exceptions.

Do not convert every error into a generic BadRequestException.

Unexpected errors should be logged and handled consistently.

Avoid leaking stack traces or sensitive information in production.

## 10. Authentication and Authorization

Keep authentication and authorization concerns separate from business logic.

Use guards and decorators where appropriate.

Never trust client-provided roles or permissions.

Verify resource ownership server-side.

Avoid duplicating authorization logic across controllers.

Keep authentication providers and token validation encapsulated.

Do not introduce authentication infrastructure when the feature does not require it.

## 11. Logging

Use the existing application logging infrastructure.

Prefer the native NestJS Logger with request-aware correlation.

Use the configured request-aware logger when available.

Log meaningful business events and failures.

Do not create a separate logging implementation inside each feature.

Do not log secrets, authorization headers, passwords, or sensitive personal information.

Avoid unnecessary logging inside high-frequency loops.

Preserve request correlation context across asynchronous operations.

## 12. External Service Architecture

Encapsulate third-party integrations inside dedicated providers or adapters.

Examples:

- StripeService
- EmailService
- StorageService
- ExternalBookingProviderService

Feature services should depend on these abstractions rather than implementing HTTP calls or provider-specific protocols inline.

Keep provider credentials in application configuration.

Handle timeouts, errors, retries, and idempotency where appropriate.

Avoid coupling application business logic to external provider response formats.

## 13. Shared Libraries

Shared reusable code belongs in `libs/`.

Examples:

- Logging infrastructure
- Common decorators
- Reusable guards
- General-purpose utilities
- External provider integrations
- Configuration helpers

Application-specific features belong in the application's `src/app/modules/`.

Do not move business logic into shared libraries without a clear reuse requirement.

Shared libraries must not import from `apps/`.

Avoid creating shared libraries for code used by only one application unless there is a clear architectural reason.

## 14. Async Operations and Concurrency

Use async/await consistently.

Handle rejected promises.

Do not leave asynchronous operations unhandled.

Avoid blocking the event loop.

Use database transactions for atomic operations.

Use conditional updates, uniqueness constraints, or other appropriate concurrency controls when multiple requests could modify the same resource.

Do not rely only on in-memory locks for correctness across multiple application instances.

Ensure payment, booking, inventory, and similar critical operations handle duplicate requests and retries safely.

## 15. Configuration and Bootstrap

Keep `main.ts` focused on application bootstrap.

Typical bootstrap responsibilities include:

- Creating the NestJS application
- Configuring global prefix
- Registering global validation
- Configuring CORS
- Registering global filters and interceptors
- Configuring logging
- Starting the HTTP server

Avoid placing business logic inside `main.ts`.

Use configuration services for environment-specific values.

Do not hardcode secrets or production URLs.

Do not install or configure Swagger/OpenAPI unless explicitly requested.

If an existing application already uses API documentation infrastructure, preserve it unless the user explicitly requests its removal.

## 16. Code Quality

Use strict TypeScript.

Avoid `any`.

Use descriptive class, method, and variable names.

Keep methods focused.

Avoid unnecessary abstractions.

Avoid duplicated logic.

Follow existing naming conventions.

Prefer readable code over clever solutions.

Do not introduce dependencies without a clear reason.

Do not generate automated tests unless explicitly requested.

## 17. Validation Before Completion

After implementing changes:

1. Verify module imports and providers.
2. Verify dependency injection.
3. Verify DTO validation.
4. Verify API route definitions.
5. Verify Prisma Client imports.
6. Check for TypeScript errors.
7. Run available Nx build targets.
8. Run lint when configured.
9. Review security and error handling.
10. Verify no unrelated applications were modified.

Do not claim validation succeeded unless the commands actually ran successfully.

## Critical Rules

- Keep controllers thin.
- Keep business logic inside services.
- Use feature-based modules.
- Use NestJS dependency injection.
- Keep Prisma application-specific.
- Respect application isolation.
- Reuse existing shared libraries.
- Avoid unnecessary abstractions.
- Do not introduce Swagger/OpenAPI by default.
- Do not modify unrelated applications.
- Do not generate automated tests unless requested.
- Always follow existing repository conventions.
