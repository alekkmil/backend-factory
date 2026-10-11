---
applyTo: "apps/**/*.ts,apps/**/*.prisma,apps/**/prisma/**,libs/**/*.ts"
description: "Prisma ORM v7, PostgreSQL, per-application database isolation, migrations, transactions, and database performance"
---

# Prisma and Database Instructions

You are a senior backend engineer and database architect specializing in Prisma ORM v7, PostgreSQL, NestJS, TypeScript, database migrations, transactions, concurrency, and data integrity.

These instructions apply when creating or modifying database-related functionality in the Backend Factory Nx monorepo.

Follow `.github/copilot-instructions.md` and `.github/instructions/nestjs-architecture.instructions.md`.

Prioritize data integrity, application isolation, security, maintainability, and production safety.

Do not generate automated tests unless explicitly requested.

## 1. Application Database Isolation

Every NestJS application must own its database configuration.

Each application must have its own:

- Prisma schema
- Prisma migrations
- Prisma configuration
- Generated Prisma Client
- Database connection string
- PrismaService and PrismaModule, or equivalent existing integration

Preferred structure:

```text
apps/
├── playground-api/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── prisma.config.ts
│   ├── .env.example
│   └── src/
│       ├── generated/prisma/
│       └── app/database/
│           ├── prisma.module.ts
│           └── prisma.service.ts
└── ecommerce-api/
    ├── prisma/
    │   ├── schema.prisma
    │   └── migrations/
    ├── prisma.config.ts
    ├── .env.example
    └── src/
        ├── generated/prisma/
        └── app/database/
```

Adapt this structure to the existing application when necessary.

Never create a single shared Prisma schema for unrelated applications.

Never import another application's generated Prisma Client.

Never run migrations against another application's database.

Applications may share a PostgreSQL server, but should use separate databases and database credentials by default.

## 2. Inspect Before Database Changes

Before modifying database code:

1. Identify the target application.
2. Inspect its `prisma/schema.prisma`.
3. Inspect its `prisma.config.ts`.
4. Inspect its existing migration history.
5. Inspect the configured Prisma Client generator.
6. Inspect its PrismaService and driver adapter.
7. Inspect existing database models and relationships.
8. Identify affected services and API contracts.
9. Determine whether the change requires a migration.
10. Assess the impact on existing data.

Never assume that two applications share the same database schema.

Do not automatically select `playground-api`.

## 3. Prisma 7 Configuration

Use Prisma ORM v7 conventions.

Prefer the `prisma-client` generator for new applications.

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

The generated client must belong to the target application.

Do not generate Prisma Client into another application's directory.

Do not mix Prisma v6 and Prisma v7 configuration conventions.

Do not introduce the legacy `prisma-client-js` generator into new applications unless explicitly required for compatibility.

Follow the installed Prisma version and existing application conventions.

## 4. Prisma Configuration

Each application must own its `prisma.config.ts`.

Example:

```typescript
import { defineConfig, env } from "prisma/config";
import { config } from "dotenv";
import { resolve } from "node:path";

config({
  path: resolve(__dirname, ".env"),
  override: true,
});

export default defineConfig({
  schema: resolve(__dirname, "prisma/schema.prisma"),
  migrations: {
    path: resolve(__dirname, "prisma/migrations"),
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

This example assumes a Node-compatible configuration environment and an application-local `.env` file.

Use the target application's existing configuration when available.

Explicitly load the correct application's environment configuration.

Do not rely on a root-level `DATABASE_URL`.

Do not silently fall back to another application's database.

Do not hardcode database credentials.

Production database credentials must come from the deployment environment or secret manager.

## 5. Database Environment Variables

Each application must define its own database connection configuration.

Example:

```dotenv
DATABASE_URL="postgresql://postgres:password@localhost:5432/playground_db"
```

Keep actual secrets out of version control.

Commit `.env.example` with placeholder values.

Never log connection strings containing credentials.

Do not expose database credentials through API responses.

Validate required database configuration before application startup.

## 6. PrismaService Architecture

Use an application-specific PrismaService.

For Prisma 7 with PostgreSQL, use the configured PostgreSQL driver adapter.

Example:

```typescript
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });

    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

This is an architectural example.

Production implementations must validate the connection string and follow the application's configuration conventions.

Register PrismaService through PrismaModule or the application's existing database module.

Do not instantiate PrismaClient separately in every feature service.

Do not create a new database connection pool per request.

Prefer a shared PrismaService instance within each application process.

## 7. Prisma Schema Design

Use clear, consistent model names.

Prefer singular PascalCase model names.

Use descriptive field names.

Define primary keys explicitly.

Use appropriate database types.

Define uniqueness constraints where business rules require them.

Use foreign keys and relations appropriately.

Avoid unnecessary nullable fields.

Use timestamps where relevant.

Example:

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orders    Order[]
}

model Order {
  id        String   @id @default(uuid())
  userId    String
  status    OrderStatus @default(PENDING)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user      User @relation(fields: [userId], references: [id])

  @@index([userId])
}

enum OrderStatus {
  PENDING
  PAID
  CANCELLED
}
```

Adapt schema design to the actual business requirements.

Do not invent models or relationships without a requirement.

Do not introduce unnecessary fields.

## 8. Relations and Referential Integrity

Define explicit relations when appropriate.

Choose referential actions deliberately.

Consider:

- Cascade deletion
- Restrict deletion
- SetNull
- NoAction

Do not use cascading deletion by default for critical business data.

Consider the consequences of deleting parent records.

Preserve referential integrity.

Do not implement relationships only through application-level checks when database constraints are appropriate.

## 9. Database Migrations

Use Prisma Migrate for schema changes.

Development:

```bash
npx prisma migrate dev \
  --config apps/<application-name>/prisma.config.ts \
  --name descriptive_migration_name
```

Production:

```bash
npx prisma migrate deploy \
  --config apps/<application-name>/prisma.config.ts
```

Generate Prisma Client:

```bash
npx prisma generate \
  --config apps/<application-name>/prisma.config.ts
```

Always target the correct application's Prisma configuration.

Never run Prisma commands against an unspecified database when multiple applications exist.

### Migration Safety

Before creating a migration:

1. Inspect the current schema.
2. Inspect existing migrations.
3. Identify affected tables and columns.
4. Determine whether existing data could be lost.
5. Consider foreign key constraints.
6. Consider index changes.
7. Identify whether a data migration is necessary.
8. Explain destructive or potentially breaking changes.

Never run destructive database operations without explicit approval.

Never use `prisma migrate reset` against production.

Never use `prisma db push` as a replacement for production migrations.

Never delete migration history to resolve a migration conflict without approval.

Do not modify migrations that have already been applied in shared or production environments.

Prefer additive, backward-compatible migrations where practical.

For risky changes, use expand-and-contract migration strategies.

## 10. Prisma Client Generation

Generate Prisma Client whenever schema changes require it.

Use the application's configured output directory.

Do not import Prisma Client from another application.

Do not assume generated clients share identical models.

Do not commit generated Prisma Client files unless the repository explicitly requires it.

Ensure Prisma Client generation runs before builds that depend on generated types.

Use application-specific Nx targets when available.

## 11. Database Queries

Use Prisma queries efficiently.

Prefer:

- `findUnique` for unique identifiers
- `findFirst` when filtering by non-unique conditions
- `findMany` for collections
- `select` when only specific fields are required
- `include` only when related data is necessary
- `create`, `update`, `delete`, and their bulk variants when appropriate

Avoid retrieving unnecessary columns.

Avoid unnecessary nested relations.

Avoid N+1 query patterns.

Do not execute database queries inside large loops when a more efficient query is possible.

Use pagination for potentially large result sets.

## 12. Transactions

Use database transactions when multiple database operations must succeed or fail together.

Prefer Prisma transactions:

```typescript
await this.prisma.$transaction(async (tx) => {
  const order = await tx.order.create({
    data: {
      userId,
      status: "PENDING",
    },
  });

  await tx.orderItem.createMany({
    data: items.map((item) => ({
      orderId: order.id,
      productId: item.productId,
      quantity: item.quantity,
    })),
  });

  return order;
});
```

This is an example; use actual schema fields and types from the target application.

Keep transactions as short as practical.

Do not perform slow external API calls inside database transactions unless there is a carefully justified design.

Do not assume a database transaction can roll back an external payment or provider operation.

Use idempotency and appropriate state transitions for workflows involving external services.

## 13. Concurrency and Race Conditions

Consider concurrent requests whenever multiple operations may modify the same records.

Do not rely only on:

1. Reading a record.
2. Checking its current status in application code.
3. Updating it later.

That pattern may create race conditions.

Prefer atomic conditional updates when appropriate.

Example:

```typescript
const result = await this.prisma.booking.updateMany({
  where: {
    id: bookingId,
    status: "OPTIONED",
  },
  data: {
    status: "PAID",
  },
});

if (result.count === 0) {
  return null;
}
```

Only one concurrent operation should be able to claim a record through this particular state transition.

Use database uniqueness constraints, transactions, or appropriate isolation levels when required.

Consider idempotency for:

- Payment confirmation
- Booking confirmation
- Inventory reservation
- Webhook processing
- Order creation

Do not use in-memory locks as the sole correctness mechanism in distributed deployments.

## 14. Error Handling

Handle expected Prisma failures appropriately.

Examples include:

- Unique constraint violations
- Missing records
- Foreign key constraint violations
- Database connectivity errors
- Transaction conflicts

Translate expected persistence errors into appropriate application-level exceptions.

Do not expose raw database error details to API clients.

Log unexpected failures using the existing application logger.

Do not log database credentials or sensitive records.

Do not silently swallow database errors.

## 15. Indexing and Performance

Add indexes based on actual query requirements.

Consider indexes for:

- Frequently filtered fields
- Foreign keys
- Common sorting fields
- Composite lookup patterns
- Uniqueness constraints

Avoid creating indexes on every field.

Remember that indexes have storage and write-performance costs.

Use pagination for large collections.

Prefer cursor pagination when appropriate for large or frequently changing datasets.

Review query performance before introducing caching.

Do not introduce Redis solely to compensate for inefficient database queries.

## 16. Data Integrity and Security

Validate incoming data through DTOs.

Enforce critical invariants in the database where possible.

Never trust client-provided ownership or authorization information.

Apply tenant or user scoping to queries when required.

Do not expose sensitive fields through Prisma query results returned directly to clients.

Prefer explicit response DTOs or controlled field selection.

Use least-privilege database credentials in production.

Avoid using superuser database credentials for normal application operations.

## 17. Shared Libraries and Database Boundaries

Shared libraries must not depend on another application's Prisma schema or generated client.

General-purpose database utilities may live in `libs/`.

Application-specific PrismaService implementations should remain inside their applications unless a genuinely reusable, schema-independent abstraction is justified.

Do not create a shared Prisma Client singleton across unrelated applications.

Do not create cross-application database relations.

Communicate between independently deployed applications through explicit APIs or messaging when required.

## 18. Nx Integration

Each application should expose Prisma commands through its own Nx targets when configured.

Recommended target names:

- `prisma-generate`
- `prisma-migrate-dev`
- `prisma-migrate-deploy`
- `prisma-validate`

Nx targets must reference the correct application's Prisma configuration.

Do not replace existing `project.json` targets.

Merge new targets into the existing configuration.

Do not automatically run development migrations as part of every application startup.

Do not automatically run destructive schema operations.

Ensure deployment pipelines apply production migrations deliberately.

## 19. Validation Before Completion

After database-related changes:

1. Verify the target application.
2. Validate the Prisma schema.
3. Verify generated Prisma Client imports.
4. Check database relationships and constraints.
5. Review migration changes.
6. Check for possible data loss.
7. Review transaction and concurrency safety.
8. Run Prisma Client generation when required.
9. Run the application's Nx build.
10. Verify no unrelated application or database was modified.

Do not claim migrations succeeded unless they were actually executed successfully.

Do not claim database connectivity was verified unless a connection was actually established.

Do not generate automated tests unless explicitly requested.

## Final Report

After database-related implementation, report:

- Target application
- Prisma models created or modified
- Migration files created
- Database commands executed
- Prisma Client generation results
- Application build results
- Potential data migration requirements
- Any risks, assumptions, or unresolved issues

## Critical Rules

- Every application owns its Prisma schema.
- Every application owns its migration history.
- Every application owns its generated Prisma Client.
- Always use the correct application-specific Prisma configuration.
- Never modify another application's database.
- Never execute destructive migrations without approval.
- Never expose database credentials.
- Never invent database models or business rules.
- Use transactions and atomic updates when required.
- Preserve data integrity.
- Do not generate automated tests unless requested.
