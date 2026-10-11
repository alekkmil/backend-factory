---
applyTo: "apps/**/*.ts,libs/**/*.ts"
description: "NestJS REST API design, controllers, DTO validation, pagination, filtering, response contracts, security, and HTTP error handling"
---

# NestJS REST API Instructions

You are a senior backend engineer and API architect specializing in NestJS, TypeScript, REST API design, validation, security, and scalable backend systems.

These instructions apply when creating or modifying REST API functionality in the Backend Factory Nx monorepo.

Follow:

- `.github/copilot-instructions.md`
- `.github/instructions/nestjs-architecture.instructions.md`
- `.github/instructions/prisma-database.instructions.md` when database access is involved

Prioritize consistent API contracts, maintainability, security, performance, and backward compatibility.

Do not generate automated tests unless explicitly requested.

Do not introduce Swagger or OpenAPI unless explicitly requested.

## 1. Inspect Existing API Conventions

Before implementing an API:

1. Identify the target NestJS application.
2. Inspect its existing controllers and routes.
3. Inspect its DTOs and response contracts.
4. Inspect global prefix and versioning configuration.
5. Inspect the global ValidationPipe.
6. Inspect authentication and authorization mechanisms.
7. Inspect existing exception filters and interceptors.
8. Inspect relevant services and Prisma models.
9. Identify reusable utilities in `libs/`.

Follow existing application conventions.

Do not modify unrelated applications.

Never automatically select `playground-api`.

Do not introduce a conflicting API response format.

## 2. REST API Design

Use resource-oriented REST conventions.

Prefer plural resource names.

Examples:

```text
GET    /users
GET    /users/:id
POST   /users
PATCH  /users/:id
DELETE /users/:id

GET    /orders
GET    /orders/:id
POST   /orders
PATCH  /orders/:id
```

Use HTTP methods according to their semantics:

- GET retrieves resources without changing state.
- POST creates resources or executes operations that are not naturally represented by other methods.
- PUT replaces a resource when full replacement is supported.
- PATCH partially updates a resource.
- DELETE removes a resource or performs a defined deletion operation.

Do not use GET for operations that change server state.

Do not invent endpoints beyond the requested functionality.

For business operations that do not fit standard CRUD, use explicit action endpoints when appropriate.

Example:

```text
POST /bookings/:id/confirm
POST /orders/:id/cancel
```

Ensure critical operations handle duplicate requests and concurrency safely.

## 3. Controller Architecture

Controllers handle HTTP-specific concerns.

Controllers should:

- Define routes.
- Receive validated input.
- Apply authentication and authorization.
- Invoke services.
- Map results to public response contracts.
- Define appropriate HTTP status codes.

Controllers must not:

- Execute Prisma queries directly.
- Implement complex business rules.
- Perform external provider calls directly.
- Contain database transactions.
- Handle unrelated business functionality.

Keep controllers thin.

Example:

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UserResponseDto } from "./dto/user-response.dto";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(dto);
  }
}
```

The service must return data matching the declared response contract.

Do not assume UUID identifiers if the existing schema uses another ID format.

## 4. Request DTOs

Use DTO classes for request validation.

Organize DTOs inside the corresponding feature.

Example:

```text
users/
└── dto/
    ├── create-user.dto.ts
    ├── update-user.dto.ts
    ├── list-users-query.dto.ts
    └── user-response.dto.ts
```

Use `class-validator` and `class-transformer`.

Example:

```typescript
import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
```

Validate:

- Required fields
- Optional fields
- Strings and numbers
- Email addresses
- UUIDs where appropriate
- Enums
- Dates
- Nested objects
- Arrays
- Numeric ranges
- String lengths

Do not use TypeScript types alone as runtime validation.

Do not trust client-provided values.

Do not use Prisma models directly as request DTOs.

Use `@IsOptional()` and other appropriate validators for optional fields.

Use explicit transformation for query parameters when necessary.

## 5. Global Validation

Use a global ValidationPipe.

For new applications, prefer:

```typescript
import { ValidationPipe } from "@nestjs/common";

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

Important rules:

- Reject unexpected request properties.
- Validate nested DTOs correctly.
- Use explicit transformation for numeric query parameters.
- Avoid unsafe implicit type conversion.
- Do not silently accept malformed input.
- Follow existing application validation conventions.

For nested objects, use appropriate nested validation and transformation decorators.

## 6. Response DTOs

Use explicit public response contracts.

Do not expose internal database records directly when they contain fields that should not be public.

Example:

```typescript
export class UserResponseDto {
  id!: string;
  email!: string;
  name!: string;
  createdAt!: Date;
}
```

Response DTOs define the public API contract.

Ensure the actual returned data matches the declared DTO.

TypeScript return types alone do not filter or serialize runtime response objects.

Use explicit mapping or the application's established serialization approach.

Never expose:

- Password hashes
- Authentication secrets
- Private tokens
- Internal provider credentials
- Sensitive internal metadata

Prefer explicit field selection when querying Prisma.

Keep response formats consistent across endpoints.

Do not introduce unnecessary response wrappers when the application already has an established convention.

## 7. HTTP Status Codes

Use appropriate status codes.

Recommended conventions:

| Operation                           | Status     |
| ----------------------------------- | ---------- |
| Successful GET                      | 200        |
| Successful POST creating a resource | 201        |
| Successful update                   | 200 or 204 |
| Successful DELETE                   | 200 or 204 |
| Invalid input                       | 400        |
| Unauthenticated                     | 401        |
| Unauthorized action                 | 403        |
| Resource not found                  | 404        |
| Conflict                            | 409        |
| Unprocessable request               | 422        |
| Rate limited                        | 429        |
| Unexpected server failure           | 500        |
| External service unavailable        | 503        |

Use the status code that best reflects the actual operation.

Do not return HTTP 200 for every response regardless of outcome.

Do not return 500 for expected validation or business errors.

Use `@HttpCode()` when overriding NestJS default response status codes.

For successful operations without a response body, use HTTP 204 when appropriate.

## 8. Error Handling

Use NestJS HTTP exceptions for expected failures.

Examples:

- BadRequestException
- UnauthorizedException
- ForbiddenException
- NotFoundException
- ConflictException
- UnprocessableEntityException
- ServiceUnavailableException

Keep business error handling inside services or appropriate domain abstractions.

Use exception filters when a consistent application-wide error format is required.

Do not catch every exception and convert it to BadRequestException.

Do not silently swallow errors.

Do not expose raw Prisma or external provider errors to clients.

Log unexpected failures through the existing request-aware logger.

Include a request ID in error responses when the application has a configured correlation mechanism.

Do not leak stack traces in production.

## 9. API Contracts

Maintain clear and consistent REST API contracts.

Every endpoint should have:

- A well-defined HTTP method.
- A predictable route.
- Validated request parameters.
- Validated request bodies where applicable.
- A consistent response structure.
- Appropriate HTTP status codes.
- Defined authentication and authorization behavior.
- Meaningful error handling.

Prefer explicit TypeScript types and DTO classes.

Avoid ambiguous response shapes.

Do not return different structures for the same successful operation without a clear reason.

Keep public API contracts independent from Prisma models.

Frontend applications should consume REST endpoints through explicitly defined request and response types.

Do not require frontend applications to import NestJS server code.

Do not install or configure Swagger or OpenAPI by default.

Do not generate API documentation endpoints or API client generators unless explicitly requested.

Preserve existing API documentation infrastructure in applications that already use it unless removal is explicitly requested.

## 10. Pagination

Use pagination for potentially large collections.

Prefer a consistent pagination convention within each application.

Offset pagination is appropriate for ordinary administrative lists and smaller datasets.

Example:

```text
GET /products?page=1&limit=20
```

A response may use:

```json
{
  "items": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

This is a recommended convention, not a mandatory format for existing applications.

Use cursor pagination when appropriate for large or frequently changing datasets.

Validate pagination parameters.

Apply reasonable limits.

Do not allow unbounded database queries by default.

Do not calculate total counts unless the endpoint contract requires them.

## 11. Filtering and Sorting

Use query parameters for filtering and sorting.

Example:

```text
GET /products?category=electronics&sortBy=price&sortOrder=asc
```

Validate allowed filter fields.

Validate allowed sort fields.

Do not allow arbitrary client-provided database field names without validation.

Prefer explicit allowlists.

Avoid passing unvalidated query objects directly into Prisma queries.

Support deterministic sorting for paginated results.

Keep filtering logic in services or dedicated query utilities rather than controllers.

## 12. API Versioning

Follow the application's existing versioning strategy.

For new applications requiring public API versioning, prefer NestJS URI versioning when appropriate.

Example:

```text
/api/v1/users
/api/v1/orders
```

Configure versioning centrally.

Do not manually duplicate version prefixes in every controller when NestJS versioning is configured.

Avoid breaking existing API contracts unnecessarily.

For breaking changes, introduce a new API version when justified.

Do not introduce versioning solely for internal endpoints unless there is a clear requirement.

## 13. Authentication and Authorization

Use guards and decorators for authentication and authorization.

Do not place JWT verification logic directly inside controllers.

Do not trust user IDs or roles supplied in request bodies.

Use verified authentication context for ownership and permission checks.

Apply authorization at the appropriate layer.

Resource-level authorization must be enforced server-side.

Do not assume that authentication alone grants access to every resource.

Do not introduce authentication infrastructure unless the application requires it.

Reuse existing guards, decorators, and authentication services when available.

## 14. API Security

Validate all external input.

Protect sensitive endpoints.

Apply rate limiting where necessary.

Use secure CORS configuration.

Do not enable unrestricted CORS in production without an explicit requirement.

Do not expose secrets in API responses.

Do not accept payment amounts, permissions, or ownership information as authoritative solely because the client supplied them.

Validate webhook signatures before processing provider events.

Consider idempotency for critical POST operations.

Avoid leaking internal infrastructure details through errors.

## 15. API Performance

Avoid unnecessary database queries.

Use pagination.

Select only necessary fields.

Avoid N+1 database queries.

Avoid blocking the Node.js event loop.

Do not perform unnecessary external API calls.

Use appropriate HTTP caching headers when justified.

Avoid introducing Redis or other infrastructure without a clear requirement.

Consider request timeouts for external services.

Keep response payloads reasonably sized.

## 16. File Uploads

When implementing file uploads:

- Validate file type.
- Validate file size.
- Enforce authorization.
- Avoid trusting client-supplied filenames.
- Store files using the application's configured storage provider.
- Avoid exposing internal filesystem paths.
- Use streaming or direct-to-storage uploads where appropriate.
- Do not store large binary files directly in PostgreSQL unless explicitly required.

Do not introduce file upload infrastructure unless requested.

## 17. External API Integration

Keep external provider calls outside controllers.

Use dedicated integration services.

Handle:

- Timeouts
- Provider errors
- Retry policies
- Authentication
- Idempotency
- Rate limits

Do not expose provider-specific error details directly to clients.

Translate provider failures into appropriate application-level errors.

Do not invent undocumented provider endpoints or response structures.

## 18. Application Isolation

Every API belongs to one target NestJS application.

Do not modify unrelated applications.

Do not share application-specific controllers or DTOs across unrelated projects without a genuine reuse requirement.

Reusable API utilities may live in `libs/`.

Shared libraries must not import from individual applications.

Keep API prefixes and versioning application-specific.

Keep application environment configuration independent.

Never assume that two applications share the same database or authentication configuration.

## 19. Implementation Workflow

Before implementation:

1. Identify the target application.
2. Inspect existing API conventions.
3. Inspect relevant modules and services.
4. Inspect Prisma models when required.
5. Identify request and response contracts.
6. Determine authentication requirements.
7. Determine validation rules.
8. Plan the implementation.

During implementation:

1. Create or update DTOs.
2. Implement service logic.
3. Implement controller endpoints.
4. Add validation.
5. Add appropriate error handling.
6. Preserve existing API contracts.
7. Apply security and authorization rules.
8. Avoid unrelated changes.

After implementation:

1. Verify route definitions.
2. Verify DTO validation.
3. Verify response contracts.
4. Verify authorization boundaries.
5. Check TypeScript errors.
6. Run available Nx build targets.
7. Run lint when configured.
8. Report assumptions and limitations.

Do not generate automated tests unless explicitly requested.

## Final Report

After implementing API functionality, report:

- Target application
- Created or modified endpoints
- HTTP methods and routes
- Request DTOs
- Response DTOs
- Authentication requirements
- Database changes
- Build and validation results
- Remaining assumptions or limitations

Do not claim successful validation unless it was actually performed.

## Critical Rules

- Keep controllers thin.
- Keep business logic in services.
- Validate external input.
- Use explicit API contracts.
- Do not install or configure Swagger/OpenAPI unless explicitly requested.
- Never expose sensitive fields.
- Never invent backend or external API behavior.
- Preserve backward compatibility where practical.
- Respect application isolation.
- Do not generate automated tests unless requested.
