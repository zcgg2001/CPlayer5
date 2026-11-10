import { hashPassword } from 'better-auth/crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// Explicit, one-time provisioning. Never run at startup or silently reset a user.
// The unique username constraint aborts the complete batch if admin already exists.
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/prepare_admin.js .local/admin-bootstrap.json');
const userId = crypto.randomUUID(), now = Date.now(), hash = await hashPassword('admin');
const batch = [
  { sql: 'INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,username) VALUES (?,?,?,?,?,?,?)', params: [userId, 'admin', 'u-admin@password.users.invalid', 0, now, now, 'admin'] },
  { sql: 'INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)', params: [crypto.randomUUID(), userId, 'credential', userId, hash, now, now] },
  { sql: 'INSERT INTO cplayer_admin_bootstrap (userId,mustChange) VALUES (?,1)', params: [userId] },
];
const path = resolve(output); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
await writeFile(path, JSON.stringify(batch, null, 2), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ userId, batchFile: path, mustChangePassword: true }));
