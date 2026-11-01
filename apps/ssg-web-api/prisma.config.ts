import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

config({ path: resolve(__dirname, '.env') });

export default defineConfig({
  schema: resolve(__dirname, 'prisma/schema.prisma'),
  migrations: {
    path: resolve(__dirname, 'prisma/migrations'),
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
