// Create (or reset) an admin user from the CLI.
//   npm run user:create -- --email you@x.com --password secret123 --role admin
//
// Idempotent: keyed on email, so re-running resets that user's password/role —
// handy if you forget the password. Roles: admin | editor | viewer.

import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../hash.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg("email");
  const password = arg("password");
  const role = arg("role") ?? "admin";

  if (!email || !password) {
    throw new Error(
      "Usage: user:create -- --email <e> --password <p> [--role admin|editor|viewer]",
    );
  }
  if (!["admin", "editor", "viewer"].includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  if (password.length < 8) throw new Error("Password must be at least 8 chars");

  const user = await prisma.adminUser.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), passwordHash: await hashPassword(password), role },
    update: { passwordHash: await hashPassword(password), role, isActive: true },
  });

  console.log(`[user:create] ${user.email} (${user.role}) — id ${user.id}`);
}

main()
  .catch((err) => {
    console.error("[user:create] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
