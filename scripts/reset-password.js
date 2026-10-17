// Usage: npm run reset-password -- <username> <new-password>
import { db } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';

const [username = 'admin', password] = process.argv.slice(2);
if (!password || password.length < 10) {
  console.error('Usage: npm run reset-password -- <username> <new-password (min 10 chars)>');
  process.exit(1);
}
const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (u) db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
else db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run(username, hashPassword(password));
db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
console.log(`Password set for "${username}". All sessions for this user were signed out.`);
