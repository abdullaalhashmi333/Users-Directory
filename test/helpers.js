'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { createApp, initDatabase } = require('../src/app');
const { createThrottle } = require('../src/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://app:app@localhost:5432/users_directory_test';
const ADMIN = { username: 'test-admin', password: 'test-admin-password' };

// Starts the app on a random port against its own empty PostgreSQL schema,
// signed in as an admin. Pass { login: false } for an anonymous client.
async function startServer(options = {}) {
  const schema = `t_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(DATABASE_URL, { schema });
  await initDatabase(pool, { seed: false, adminUsername: ADMIN.username, adminPassword: ADMIN.password, ...options });
  const app = createApp(pool, { testMode: true, throttle: createThrottle(), ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const client = makeClient(base);
  if (options.login !== false) await client.login(ADMIN.username, ADMIN.password);

  return {
    ...client,
    base,
    pool,
    client: () => makeClient(base),
    async close() {
      await new Promise((r) => server.close(r));
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

// A tiny HTTP client that keeps the session cookie, like a browser.
function makeClient(base) {
  let cookie = '';
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const [pair] = set.split(';');
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  return {
    call,
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b, h),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    login: (username, password) => call('POST', '/api/login', { username, password }),
    get cookie() { return cookie; },
  };
}

module.exports = { startServer, ADMIN, DATABASE_URL };
