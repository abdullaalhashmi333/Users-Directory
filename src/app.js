'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createDirectory, AppError } = require('./directory');
const { seedSampleData, resetSampleData } = require('./seed');
const { buildWorkbook } = require('./export');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Optional HTTP Basic auth, only active when APP_PASSWORD is set.
function basicAuth(user, password) {
  return (req, res, next) => {
    if (req.path === '/health') return next();
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const [u, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
      if (safeEqual(u, user) && safeEqual(rest.join(':'), password)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Users Directory", charset="UTF-8"');
    res.status(401).send('Authentication required.');
  };
}

function fileName(base) {
  const stamp = new Date().toISOString().slice(0, 10);
  const ascii = base.replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'entity';
  return { ascii: `${ascii}-${stamp}.xlsx`, utf8: encodeURIComponent(`${base}-${stamp}.xlsx`) };
}

function createApp(db, options = {}) {
  const directory = createDirectory(db);
  const testMode = options.testMode ?? process.env.TEST_MODE !== 'false';
  const seed = options.seed ?? process.env.SEED_SAMPLE_DATA !== 'false';
  if (seed && directory.stats().entities === 0) seedSampleData(directory);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const password = options.password ?? process.env.APP_PASSWORD;
  if (password) app.use(basicAuth(options.user ?? process.env.APP_USER ?? 'admin', password));

  app.get('/health', (req, res) => res.json({ ok: true, ...directory.stats() }));

  const api = express.Router();
  api.get('/config', (req, res) => res.json({ testMode }));
  api.get('/stats', (req, res) => res.json(directory.stats()));
  api.get('/tree', (req, res) => {
    res.json(directory.tree({ search: req.query.q || '', entityId: req.query.entityId }));
  });

  api.post('/entities', (req, res) => res.status(201).json(directory.createEntity(req.body)));
  api.put('/entities/:id', (req, res) => res.json(directory.updateEntity(req.params.id, req.body)));
  api.get('/entities/:id/impact', (req, res) => res.json(directory.entityImpact(req.params.id)));
  api.delete('/entities/:id', (req, res) => res.json({ deleted: directory.deleteEntity(req.params.id) }));

  api.post('/entities/:id/departments', (req, res) => res.status(201).json(directory.createDepartment(req.params.id, req.body)));
  api.put('/departments/:id', (req, res) => res.json(directory.updateDepartment(req.params.id, req.body)));
  api.get('/departments/:id/impact', (req, res) => res.json(directory.departmentImpact(req.params.id)));
  api.delete('/departments/:id', (req, res) => res.json({ deleted: directory.deleteDepartment(req.params.id) }));

  api.post('/departments/:id/focal-points', (req, res) => res.status(201).json(directory.createFocalPoint(req.params.id, req.body)));
  api.get('/focal-points/:id', (req, res) => res.json(directory.getFocalPoint(req.params.id)));
  api.put('/focal-points/:id', (req, res) => res.json(directory.updateFocalPoint(req.params.id, req.body)));
  api.delete('/focal-points/:id', (req, res) => res.json({ deleted: directory.deleteFocalPoint(req.params.id) }));

  api.get('/email-check', (req, res) => {
    res.json({ duplicates: directory.emailDuplicates(req.query.email || '', req.query.excludeId || 0) });
  });

  api.get('/export.xlsx', async (req, res, next) => {
    try {
      const tree = directory.tree({ entityId: req.query.entityId });
      const name = fileName(req.query.entityId ? tree[0].name : 'users-directory');
      const buf = await buildWorkbook(tree);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="${name.ascii}"; filename*=UTF-8''${name.utf8}`);
      res.send(Buffer.from(buf));
    } catch (err) {
      next(err);
    }
  });

  api.post('/admin/reset-sample-data', (req, res) => {
    if (!testMode) throw new AppError(403, 'Resetting data is only allowed in test mode.');
    res.json(resetSampleData(directory));
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

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

module.exports = { createApp };
