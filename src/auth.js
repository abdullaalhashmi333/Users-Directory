'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { key } = require('./db');
const { AppError, clean, id, isUniqueViolation } = require('./directory');

const scrypt = promisify(crypto.scrypt);

const ROLES = ['admin', 'editor', 'viewer'];
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const SESSION_COOKIE = 'ud_session';
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const MIN_PASSWORD = 10;
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;

// ---------- passwords ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}

// Used when a username does not exist, so failed logins take the same time either way.
let dummyHash;
async function burnTime(password) {
  dummyHash ||= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

function checkPassword(password) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD) throw new AppError(400, `Password must be at least ${MIN_PASSWORD} characters.`, { field: 'password' });
  if (p.length > 200) throw new AppError(400, 'Password is too long.', { field: 'password' });
  return p;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- login throttling ----------
// In-memory: after 5 failures for a username (or 20 from one address) in 15 minutes,
// further attempts are refused until the window passes.
function createThrottle({ perUser = 5, perIp = 20, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  const count = (k) => {
    const now = Date.now();
    const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
    hits.set(k, list);
    return list.length;
  };
  return {
    blocked(ip, username) {
      return count(`u:${username}`) >= perUser || count(`ip:${ip}`) >= perIp;
    },
    fail(ip, username) {
      for (const k of [`u:${username}`, `ip:${ip}`]) hits.set(k, [...(hits.get(k) || []), Date.now()]);
    },
    succeed(username) {
      hits.delete(`u:${username}`);
    },
  };
}

// ---------- users and sessions ----------
const PUBLIC_USER = 'id, username, display_name, role, active, last_login_at, created_at, updated_at';

function createAuth(pool) {
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];

  function userInput(body, { partial = false } = {}) {
    const out = {};
    if (!partial || body.username !== undefined) {
      const username = clean(body.username);
      if (!USERNAME_RE.test(username)) {
        throw new AppError(400, 'Username must be 3–64 characters: letters, numbers, dot, dash, underscore or @.', { field: 'username' });
      }
      out.username = username;
    }
    if (!partial || body.role !== undefined) {
      if (!ROLES.includes(body.role)) throw new AppError(400, 'Role must be admin, editor or viewer.', { field: 'role' });
      out.role = body.role;
    }
    if (body.display_name !== undefined) out.display_name = clean(body.display_name).slice(0, 200);
    if (body.active !== undefined) out.active = Boolean(body.active);
    return out;
  }

  async function getUser(userId) {
    const u = await one(`SELECT ${PUBLIC_USER} FROM users WHERE id = $1`, [id(userId)]);
    if (!u) throw new AppError(404, 'User not found.');
    return u;
  }

  async function activeAdminCount(exceptId = 0) {
    return (await one("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1", [exceptId])).n;
  }

  return {
    async userCount() {
      return (await one('SELECT COUNT(*)::int AS n FROM users')).n;
    },

    async createUser(body) {
      const u = userInput(body);
      const hash = await hashPassword(checkPassword(body.password));
      try {
        return await one(`INSERT INTO users (username, username_key, display_name, password_hash, role)
                          VALUES ($1, $2, $3, $4, $5) RETURNING ${PUBLIC_USER}`,
        [u.username, key(u.username), u.display_name || '', hash, u.role]);
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError(409, `The username "${u.username}" is already taken.`, { field: 'username' });
        throw err;
      }
    },

    // Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD when there are no users at all.
    async bootstrapAdmin(username, password) {
      if (!username || !password) return null;
      if ((await this.userCount()) > 0) return null;
      return this.createUser({ username, password, role: 'admin', display_name: 'Administrator' });
    },

    listUsers() {
      return pool.query(`SELECT ${PUBLIC_USER} FROM users ORDER BY username_key`).then((r) => r.rows);
    },

    async updateUser(userId, body, actor) {
      const existing = await getUser(userId);
      const u = userInput(body, { partial: true });
      const self = existing.id === actor.id;
      if (self && (u.active === false || (u.role && u.role !== 'admin'))) {
        throw new AppError(400, 'You cannot remove your own admin access or deactivate yourself.');
      }
      const losesAdmin = existing.role === 'admin' && existing.active && (u.active === false || (u.role && u.role !== 'admin'));
      if (losesAdmin && (await activeAdminCount(existing.id)) === 0) {
        throw new AppError(400, 'There must always be at least one active admin.');
      }
      const next = { ...existing, ...u };
      let hash = null;
      if (body.password) hash = await hashPassword(checkPassword(body.password));
      try {
        const row = await one(`UPDATE users SET username = $1, username_key = $2, display_name = $3, role = $4, active = $5,
                                 password_hash = COALESCE($6, password_hash), updated_at = now()
                               WHERE id = $7 RETURNING ${PUBLIC_USER}`,
        [next.username, key(next.username), next.display_name, next.role, next.active, hash, existing.id]);
        // A password reset, role change or deactivation signs the user out everywhere.
        if (hash || u.active === false || (u.role && u.role !== existing.role)) {
          await pool.query('DELETE FROM sessions WHERE user_id = $1', [existing.id]);
        }
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError(409, `The username "${next.username}" is already taken.`, { field: 'username' });
        throw err;
      }
    },

    async deleteUser(userId, actor) {
      const existing = await getUser(userId);
      if (existing.id === actor.id) throw new AppError(400, 'You cannot delete your own account.');
      if (existing.role === 'admin' && existing.active && (await activeAdminCount(existing.id)) === 0) {
        throw new AppError(400, 'There must always be at least one active admin.');
      }
      await pool.query('DELETE FROM users WHERE id = $1', [existing.id]);
      return existing;
    },

    async changeOwnPassword(user, currentPassword, newPassword) {
      const row = await one('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      if (!row || !(await verifyPassword(currentPassword || '', row.password_hash))) {
        throw new AppError(400, 'Current password is not correct.', { field: 'current_password' });
      }
      const hash = await hashPassword(checkPassword(newPassword));
      await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, user.id]);
    },

    // Returns the user on success, or null for a wrong username/password or inactive account.
    async verifyLogin(username, password) {
      const row = await one(`SELECT ${PUBLIC_USER}, password_hash FROM users WHERE username_key = $1`, [key(username || '')]);
      if (!row) {
        await burnTime(password || '');
        return null;
      }
      const ok = await verifyPassword(password || '', row.password_hash);
      if (!ok || !row.active) return null;
      delete row.password_hash;
      return row;
    },

    async createSession(user) {
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at)
                        VALUES ($1, $2, now() + make_interval(hours => $3))`, [sha256(token), user.id, SESSION_HOURS]);
      await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      await pool.query('DELETE FROM sessions WHERE expires_at < now()');
      return token;
    },

    async userForToken(token) {
      if (!token) return null;
      return one(`SELECT u.id, u.username, u.display_name, u.role
                  FROM sessions s JOIN users u ON u.id = s.user_id
                  WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [sha256(token)]);
    },

    destroySession(token) {
      if (!token) return Promise.resolve();
      return pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    },
  };
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sessionCookie(token, { secure, maxAgeSeconds }) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : null,
    `Max-Age=${maxAgeSeconds}`,
  ].filter(Boolean).join('; ');
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'Please sign in.'));
    if (ROLE_RANK[req.user.role] < ROLE_RANK[role]) return next(new AppError(403, 'You do not have permission to do this.'));
    next();
  };
}

module.exports = {
  createAuth, createThrottle, hashPassword, verifyPassword, readCookie, sessionCookie, requireRole,
  ROLES, SESSION_COOKIE, SESSION_HOURS,
};
