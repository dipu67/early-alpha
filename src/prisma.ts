// Prisma client — the backend's OWN client, generated from backend/prisma/schema.prisma
// (see `npm run prisma:generate`) but pointed at the same Postgres as early-alpha.
// The backend never imports the root project's client; it shares only the schema shape.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { env } from "./env.js";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });
