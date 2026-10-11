---
applyTo: "apps/**/*.ts,libs/**/*.ts"
description: "NestJS native logging, AsyncLocalStorage, request correlation IDs, HTTP request logging, error logging, and production observability"
---

# NestJS Logging Instructions

You are a senior NestJS backend engineer specializing in structured application logging, request correlation, asynchronous context propagation, and production observability.

These instructions apply when implementing or modifying logging functionality in the Backend Factory Nx monorepo.

Follow the repository's global Copilot instructions and existing NestJS architecture conventions.

Do not generate automated tests unless explicitly requested.

## 1. Logging Technology

The Backend Factory uses:

- Native NestJS Logger and ConsoleLogger
- Node.js AsyncLocalStorage
- Unique request correlation IDs
- HTTP request logging middleware
- Structured JSON logging in production
- Context-aware application logging

Do not introduce Winston, Pino, Morgan, or other logging libraries unless explicitly requested.

Prefer built-in NestJS and Node.js capabilities.

## 2. Logging Objectives

The logging infrastructure must support:

1. Tracking concurrent HTTP requests independently.
2. Assigning a unique request ID to every incoming request.
3. Automatically including the request ID in application logs.
4. Preserving request context across normal asynchronous operations.
5. Logging HTTP method, route, status code, and duration.
6. Logging meaningful business operations.
7. Logging unexpected failures.
8. Producing machine-readable logs in production.
9. Avoiding sensitive data exposure.
10. Reusing the same logging architecture across NestJS applications.

Logging must not require passing `requestId` manually through every service method.

## 3. Request Correlation

Use Node.js AsyncLocalStorage to maintain request-specific context.

Each incoming HTTP request must receive its own request ID.

Generate IDs using `crypto.randomUUID()` by default.

If the application receives a trusted request ID from a gateway or reverse proxy, it may reuse it after appropriate validation.

Do not blindly trust arbitrary client-supplied request IDs.

Expose the active request ID through the `X-Request-ID` response header.

Each request must have an isolated context, including when multiple requests execute concurrently.

Example:

```text
[HTTP] [request-a] POST /orders
[HTTP] [request-b] GET /users

[OrdersService] [request-a] Creating order
[UsersService] [request-b] Fetching users

[OrdersService] [request-a] Calling payment provider
[UsersService] [request-b] Found users

[HTTP] [request-b] GET /users 200 35ms
[HTTP] [request-a] POST /orders 201 240ms
```

Never store the current request ID in a mutable global variable or singleton property.

## 4. Request Context Architecture

Prefer the following structure:

```text
src/app/common/logging/
├── logging.module.ts
├── app-logger.service.ts
├── request-context.ts
└── request-context.middleware.ts
```

Adapt to the existing application structure.

Do not duplicate existing logging infrastructure.

The request context should expose a typed interface.

Example:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

export const requestContext =
  new AsyncLocalStorage<RequestContext>();
```

Keep request context access centralized.

Do not instantiate a separate AsyncLocalStorage instance for each feature module.

Do not introduce request-scoped NestJS providers solely for request ID propagation.

## 5. HTTP Request Middleware

Implement middleware that:

1. Generates or validates the request ID.
2. Initializes AsyncLocalStorage.
3. Adds `X-Request-ID` to the response.
4. Records the request start time.
5. Logs request completion.
6. Logs response status and duration.
7. Handles prematurely closed connections appropriately.
8. Calls `next()` inside the AsyncLocalStorage context.

Use `performance.now()` or another monotonic clock for measuring duration.

Prefer `res.once('finish', ...)` for successful response completion.

Handle `close` separately when the response did not finish.

Avoid logging the same request twice.

Do not log request bodies, query parameter values, cookies, or authorization headers by default.

Prefer a safe route template or sanitized path when logging URLs.

Do not log raw URLs containing sensitive query parameters.

## 6. NestJS 11 Middleware Registration

Use NestJS 11-compatible route patterns.

For application-wide middleware, prefer:

```typescript
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({
        path: '{*path}',
        method: RequestMethod.ALL,
      });
  }
}
```

Do not use legacy wildcard patterns such as `'*'` that trigger `LegacyRouteConverter` warnings.

Ensure middleware covers the intended application routes.

Consider global prefixes and routes excluded from middleware when configuring request correlation.

## 7. Request-Aware Logger

Create a reusable logger built on NestJS ConsoleLogger or the application's existing logger implementation.

The logger should automatically retrieve the current request ID from AsyncLocalStorage.

Prefer preserving the standard NestJS Logger API.

Support:

- log
- warn
- error
- debug
- verbose
- fatal, when supported by the installed NestJS version

Preserve:

- Logging context
- Error stack traces
- Additional metadata
- Existing NestJS log levels

Do not lose structured metadata by converting every log argument into a string.

Do not discard Error objects or stack traces.

Avoid modifying the logging behavior of unrelated applications.

When no request context exists, logs must still work normally.

Use a consistent fallback such as `system` or omit the request ID.

## 8. Global Logger Integration

When implementing logging infrastructure, determine whether the application needs:

1. An injectable logging service.
2. A custom ConsoleLogger registered through NestFactory.
3. Both, with a single consistent logging implementation.

Prefer a custom ConsoleLogger when the requirement is to automatically correlate logs emitted through the standard NestJS logging infrastructure.

Configure the application logger during bootstrap.

Ensure dependency-injected logging and framework logging use consistent formatting.

Do not claim that a custom injectable AppLogger automatically modifies every existing `new Logger()` instance.

Verify the actual logger integration mechanism before promising global correlation.

## 9. Logging Module

A LoggingModule may register and export reusable logging providers.

Use `@Global()` only when the logger is genuinely required throughout the application.

Do not introduce circular module dependencies.

Do not register duplicate logger providers unnecessarily.

Do not create a LoggingModule solely to store an AsyncLocalStorage instance if no injectable providers are needed.

Keep logging infrastructure independent of application-specific business modules.

## 10. Business Operation Logging

Log meaningful business events.

Examples:

- Booking created
- Payment processing started
- Provider confirmation requested
- Provider confirmation failed
- Background job completed
- External API request failed

Prefer structured, concise log messages.

Include relevant non-sensitive identifiers when useful.

Avoid logging complete database records or third-party API payloads by default.

Do not log every trivial method invocation.

Use appropriate log levels:

- `log`: Normal application events
- `warn`: Recoverable or unexpected conditions
- `error`: Failed operations
- `debug`: Development diagnostics
- `verbose`: Detailed diagnostics when explicitly enabled
- `fatal`: Critical unrecoverable conditions when supported

## 11. Error Logging

Unexpected errors should be logged with their stack traces.

Preserve the request ID when an error occurs during an HTTP request.

Avoid logging the same exception repeatedly at multiple layers.

Prefer logging unexpected errors at a consistent application boundary.

Expected business errors do not always require error-level logging.

Do not expose internal stack traces through HTTP responses.

Do not log credentials or sensitive provider responses.

## 12. External API Logging

For outgoing HTTP calls, log useful metadata when appropriate:

- Provider name
- Operation name
- Request correlation ID
- HTTP method
- Sanitized endpoint
- Response status
- Duration
- Failure category

Do not log:

- Authorization tokens
- API keys
- Raw payment data
- Passwords
- Sensitive request bodies
- Full URLs containing credentials

Use the active request context for correlation.

Do not assume that AsyncLocalStorage automatically propagates request IDs across different processes or remote services.

When distributed tracing is required, propagate correlation IDs explicitly through trusted outgoing request headers.

## 13. Background Jobs and Scheduled Tasks

Background jobs do not necessarily originate from an HTTP request.

Initialize a new AsyncLocalStorage context for independent background operations when correlation is required.

Use a job ID or generated correlation ID.

Do not reuse an unrelated HTTP request's context.

Preserve context across asynchronous job execution where supported.

Log job start, completion, failure, and duration when useful.

## 14. Production Logging

Prefer structured JSON logging in production.

Use the installed NestJS version's supported JSON logging capabilities.

Maintain useful fields such as:

- Timestamp
- Log level
- Context
- Request ID
- Message
- Error stack when applicable

Prefer writing logs to standard output and standard error.

Let the deployment platform collect and retain logs.

Do not write production logs to application source directories.

Do not introduce file-based logging or log rotation unless required by the deployment environment.

Avoid excessive logging that increases infrastructure costs.

## 15. Sensitive Data Protection

Never log:

- Passwords
- JWT tokens
- Authorization headers
- Session cookies
- API secrets
- Database connection strings
- Payment card data
- Private encryption keys

Treat request bodies and query parameters as potentially sensitive.

Use explicit allowlists for metadata rather than attempting to log everything and redact afterward.

Ensure error logging does not accidentally expose secrets.

## 16. Application Isolation

Each NestJS application must configure its own logging integration.

Reusable logging infrastructure may live in:

`libs/logging/`

Shared logging libraries must not import from individual applications.

Do not assume all applications have the same routes, authentication system, or deployment configuration.

Each application may independently configure:

- Log levels
- JSON logging
- Request logging exclusions
- Trusted proxy behavior
- Correlation header propagation

Do not modify unrelated applications when implementing logging.

## 17. Implementation Workflow

Before implementation:

1. Identify the target application.
2. Inspect its existing logging implementation.
3. Inspect NestJS bootstrap configuration.
4. Inspect existing middleware.
5. Check whether AsyncLocalStorage is already configured.
6. Identify whether logging infrastructure exists in `libs/`.

During implementation:

1. Implement or reuse request context.
2. Configure request ID generation.
3. Register request middleware.
4. Configure the request-aware logger.
5. Preserve existing logging behavior.
6. Ensure error stack traces remain available.
7. Configure production JSON output where appropriate.

After implementation:

1. Verify the application builds.
2. Check TypeScript correctness.
3. Verify middleware route patterns.
4. Check that request IDs are included in logs.
5. Verify independent parallel requests do not share request IDs.
6. Verify logs outside HTTP requests still work.
7. Check that sensitive data is not logged.
8. Report any unverified behavior.

Do not claim runtime verification succeeded unless it was actually performed.

Do not generate automated tests unless explicitly requested.

## Final Report

Report:

- Target application
- Logging components created or modified
- Request ID generation behavior
- Logger integration approach
- HTTP request logging behavior
- Production logging configuration
- Build results
- Any remaining limitations

## Critical Rules

- Use native NestJS logging by default.
- Use AsyncLocalStorage for request correlation.
- Never share mutable request state between concurrent requests.
- Preserve standard logging functionality.
- Preserve error stacks and metadata.
- Never log sensitive information.
- Avoid duplicate request logs.
- Do not introduce Winston or Pino without approval.
- Respect application isolation.
- Do not generate automated tests unless requested.
