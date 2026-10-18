'use strict';

const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

// Starts the app on a random port with an in-memory database.
async function startServer(options = {}) {
  const db = openDb(':memory:');
  const app = createApp(db, { seed: false, testMode: true, password: '', ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }

  return {
    base,
    call,
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { startServer };
