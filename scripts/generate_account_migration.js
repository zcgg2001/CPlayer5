import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../sites/account-auth.js';
const db = new DatabaseSync(':memory:');
mkdirSync('migrations', { recursive: true });
const previous = readdirSync('migrations').filter(name => /^\d+_.+\.sql$/.test(name)).sort();
for (const name of previous) db.exec(readFileSync(`migrations/${name}`, 'utf8'));
const migration = await getMigrations(authOptions({ AUTH_URL: 'http://127.0.0.1:8787', AUTH_SECRET: 'migration-only-placeholder-not-a-runtime-secret', ACCOUNTS_DB: db }));
const sql = (await migration.compileMigrations()).replaceAll('create table ', 'create table if not exists ').replaceAll('create index ', 'create index if not exists ').replaceAll('create unique index ', 'create unique index if not exists ');
if (sql.replace(/[;\s]/g, '')) {
  const number = String(Math.max(0, ...previous.map(name => parseInt(name, 10))) + 1).padStart(4, '0');
  const path = `migrations/${number}_auth.sql`;
  writeFileSync(path, `-- Generated with Better Auth 1.7.18. Review before applying.\n${sql}\n`, { flag: 'wx' });
  console.log(`Generated ${path}`);
} else console.log('Account schema is up to date.');
db.close();
