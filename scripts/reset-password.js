// Usage: npm run reset-password -- <username> <new-password>
// Uses the local database, or the live one when TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN are set (copy them from Vercel → Settings → Environment Variables).
import { db, ready } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';

const [username = 'admin', password] = process.argv.slice(2);
if (!password || password.length < 10) {
  console.error('Usage: npm run reset-password -- <username> <new-password (min 10 chars)>');
  process.exit(1);
}
await ready();
const u = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (u) await db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
else await db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run(username, hashPassword(password));
await db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
console.log(`Password set for "${username}". All sessions for this user were signed out.`);
