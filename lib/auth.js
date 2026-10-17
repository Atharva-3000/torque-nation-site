import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEYLEN, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const newToken = () => randomBytes(32).toString('base64url');

// Simple in-memory login throttle: 8 attempts per 15 minutes per IP.
const attempts = new Map();
export function throttle(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, reset: now + 15 * 60_000 };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + 15 * 60_000; }
  rec.n += 1;
  attempts.set(ip, rec);
  return rec.n <= 8;
}
export const clearThrottle = (ip) => attempts.delete(ip);
