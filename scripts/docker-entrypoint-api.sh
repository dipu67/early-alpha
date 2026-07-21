#!/bin/sh
set -e

echo "[api] waiting for database…"
i=0
until node --input-type=module -e "
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await c.connect();
  await c.query('SELECT 1');
  await c.end();
  process.exit(0);
} catch {
  process.exit(1);
}
" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[api] database not ready after 60s" >&2
    exit 1
  fi
  sleep 1
done

echo "[api] applying prisma migrations…"
npx prisma migrate deploy --schema src/prisma/schema.prisma

echo "[api] starting early-alpha (API + workers + bots + schedulers)…"
exec node dist/index.js
