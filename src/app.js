'use strict';

const path = require('node:path');
const express = require('express');
const { createDirectory, AppError } = require('./directory');
const { migrate } = require('./db');
const { seedSampleData } = require('./seed');
const { buildWorkbook } = require('./export');
const {
  createAuth, createThrottle, readCookie, sessionCookie, requireRole, SESSION_COOKIE, SESSION_HOURS,
} = require('./auth');

// Express 4 does not catch rejected promises, so async handlers go through this.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fileName(base) {
  const stamp = new Date().toISOString().slice(0, 10);
  const ascii = base.replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'entity';
  return { ascii: `${ascii}-${stamp}.xlsx`, utf8: encodeURIComponent(`${base}-${stamp}.xlsx`) };
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
}

// Blocks state-changing requests sent from another site (on top of SameSite cookies).
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.headers.host) return next(new AppError(403, 'Cross-site request refused.'));
  }
  next();
}

// Runs migrations, creates the first admin if configured, and optionally loads sample data.
async function initDatabase(pool, options = {}) {
  await migrate(pool);
  const auth = createAuth(pool);
  const admin = await auth.bootstrapAdmin(
    options.adminUsername ?? process.env.ADMIN_USERNAME,
    options.adminPassword ?? process.env.ADMIN_PASSWORD,
  );
  const seed = options.seed ?? process.env.SEED_SAMPLE_DATA === 'true';
  const seeded = seed ? await seedSampleData(pool) : { seeded: false };
  return { adminCreated: Boolean(admin), seeded: seeded.seeded };
}

function createApp(pool, options = {}) {
  const directory = createDirectory(pool);
  const auth = createAuth(pool);
  const throttle = options.throttle ?? createThrottle();
  const testMode = options.testMode ?? process.env.TEST_MODE !== 'false';

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? 1); // Railway terminates HTTPS at its proxy.
  app.use(securityHeaders);

  app.get('/health', wrap(async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  }));

  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(express.json({ limit: '100kb' }));
  api.use(sameOrigin);
  api.use(wrap(async (req, res, next) => {
    req.sessionToken = readCookie(req, SESSION_COOKIE);
    req.user = await auth.userForToken(req.sessionToken);
    next();
  }));

  const secureCookie = (req) => req.secure || process.env.NODE_ENV === 'production';

  // ---- Public: sign in / out ----
  api.get('/config', wrap(async (req, res) => {
    res.json({ testMode, setupRequired: (await auth.userCount()) === 0 });
  }));

  api.post('/login', wrap(async (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    if (throttle.blocked(req.ip, username)) {
      throw new AppError(429, 'Too many failed sign-in attempts. Please wait 15 minutes and try again.');
    }
    const user = await auth.verifyLogin(req.body.username, req.body.password);
    if (!user) {
      throttle.fail(req.ip, username);
      throw new AppError(401, 'Wrong username or password.');
    }
    throttle.succeed(username);
    if (req.sessionToken) await auth.destroySession(req.sessionToken);
    const token = await auth.createSession(user);
    res.set('Set-Cookie', sessionCookie(token, { secure: secureCookie(req), maxAgeSeconds: SESSION_HOURS * 3600 }));
    res.json({ user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
  }));

  api.post('/logout', wrap(async (req, res) => {
    await auth.destroySession(req.sessionToken);
    res.set('Set-Cookie', sessionCookie('', { secure: secureCookie(req), maxAgeSeconds: 0 }));
    res.json({ ok: true });
  }));

  // ---- Everything below needs a signed-in user ----
  const viewer = requireRole('viewer');
  const editor = requireRole('editor');
  const admin = requireRole('admin');

  api.get('/me', viewer, (req, res) => res.json({ user: req.user }));
  api.post('/me/password', viewer, wrap(async (req, res) => {
    await auth.changeOwnPassword(req.user, req.body.current_password, req.body.new_password);
    res.json({ ok: true });
  }));

  api.get('/stats', viewer, wrap(async (req, res) => res.json(await directory.stats())));
  api.get('/tree', viewer, wrap(async (req, res) => {
    res.json(await directory.tree({ search: String(req.query.q || ''), entityId: req.query.entityId }));
  }));

  api.post('/entities', editor, wrap(async (req, res) => res.status(201).json(await directory.createEntity(req.body))));
  api.put('/entities/:id', editor, wrap(async (req, res) => res.json(await directory.updateEntity(req.params.id, req.body))));
  api.get('/entities/:id/impact', editor, wrap(async (req, res) => res.json(await directory.entityImpact(req.params.id))));
  api.delete('/entities/:id', editor, wrap(async (req, res) => res.json({ deleted: await directory.deleteEntity(req.params.id) })));

  api.post('/entities/:id/departments', editor, wrap(async (req, res) => res.status(201).json(await directory.createDepartment(req.params.id, req.body))));
  api.put('/departments/:id', editor, wrap(async (req, res) => res.json(await directory.updateDepartment(req.params.id, req.body))));
  api.get('/departments/:id/impact', editor, wrap(async (req, res) => res.json(await directory.departmentImpact(req.params.id))));
  api.delete('/departments/:id', editor, wrap(async (req, res) => res.json({ deleted: await directory.deleteDepartment(req.params.id) })));

  api.post('/departments/:id/focal-points', editor, wrap(async (req, res) => res.status(201).json(await directory.createFocalPoint(req.params.id, req.body))));
  api.get('/focal-points/:id', viewer, wrap(async (req, res) => res.json(await directory.getFocalPoint(req.params.id))));
  api.put('/focal-points/:id', editor, wrap(async (req, res) => res.json(await directory.updateFocalPoint(req.params.id, req.body))));
  api.delete('/focal-points/:id', editor, wrap(async (req, res) => res.json({ deleted: await directory.deleteFocalPoint(req.params.id) })));

  api.get('/email-check', editor, wrap(async (req, res) => {
    res.json({ duplicates: await directory.emailDuplicates(String(req.query.email || ''), req.query.excludeId || 0) });
  }));

  api.get('/export.xlsx', viewer, wrap(async (req, res) => {
    const tree = await directory.tree({ entityId: req.query.entityId });
    const name = fileName(req.query.entityId ? tree[0].name : 'users-directory');
    const buf = await buildWorkbook(tree);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${name.ascii}"; filename*=UTF-8''${name.utf8}`);
    res.send(Buffer.from(buf));
  }));

  // ---- User management (admins) ----
  api.get('/users', admin, wrap(async (req, res) => res.json(await auth.listUsers())));
  api.post('/users', admin, wrap(async (req, res) => res.status(201).json(await auth.createUser(req.body))));
  api.put('/users/:id', admin, wrap(async (req, res) => res.json(await auth.updateUser(req.params.id, req.body, req.user))));
  api.delete('/users/:id', admin, wrap(async (req, res) => res.json({ deleted: await auth.deleteUser(req.params.id, req.user) })));

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  // The interface itself holds no data; everything it shows comes from the signed-in API.
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, ...err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

module.exports = { createApp, initDatabase };
