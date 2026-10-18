'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { startServer } = require('./helpers');

describe('entities', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  test('create, edit and list an entity with timestamps', async () => {
    const created = await s.post('/api/entities', { name: '  Alpha Agency  ' });
    assert.equal(created.status, 201);
    assert.equal(created.data.name, 'Alpha Agency');
    assert.ok(created.data.created_at && created.data.updated_at);

    await new Promise((r) => setTimeout(r, 5));
    const edited = await s.put(`/api/entities/${created.data.id}`, { name: 'Alpha Agency Renamed' });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.created_at, created.data.created_at);
    assert.ok(edited.data.updated_at > created.data.updated_at);

    const tree = await s.get('/api/tree');
    assert.deepEqual(tree.data.map((e) => e.name), ['Alpha Agency Renamed']);
  });

  test('name is required', async () => {
    const r = await s.post('/api/entities', { name: '   ' });
    assert.equal(r.status, 400);
    assert.equal(r.data.field, 'name');
  });

  test('name must be unique, ignoring case and spaces', async () => {
    await s.post('/api/entities', { name: 'Beta Office' });
    const dup = await s.post('/api/entities', { name: '  beta   office ' });
    assert.equal(dup.status, 409);
    const other = await s.post('/api/entities', { name: 'Gamma' });
    const rename = await s.put(`/api/entities/${other.data.id}`, { name: 'BETA OFFICE' });
    assert.equal(rename.status, 409);
  });

  test('unknown entity returns 404', async () => {
    assert.equal((await s.put('/api/entities/9999', { name: 'x' })).status, 404);
    assert.equal((await s.del('/api/entities/9999')).status, 404);
  });
});

describe('departments', () => {
  let s; let entityA; let entityB;
  before(async () => {
    s = await startServer();
    entityA = (await s.post('/api/entities', { name: 'Entity A' })).data;
    entityB = (await s.post('/api/entities', { name: 'Entity B' })).data;
  });
  after(() => s.close());

  test('name is unique within its entity only', async () => {
    assert.equal((await s.post(`/api/entities/${entityA.id}/departments`, { name: 'Finance' })).status, 201);
    assert.equal((await s.post(`/api/entities/${entityA.id}/departments`, { name: 'finance' })).status, 409);
    assert.equal((await s.post(`/api/entities/${entityB.id}/departments`, { name: 'Finance' })).status, 201);
  });

  test('edit department and reject duplicate rename', async () => {
    const hr = (await s.post(`/api/entities/${entityA.id}/departments`, { name: 'HR' })).data;
    assert.equal((await s.put(`/api/departments/${hr.id}`, { name: 'Human Resources' })).data.name, 'Human Resources');
    assert.equal((await s.put(`/api/departments/${hr.id}`, { name: 'Finance' })).status, 409);
    assert.equal((await s.put(`/api/departments/${hr.id}`, { name: '' })).status, 400);
  });

  test('cannot add a department to a missing entity', async () => {
    assert.equal((await s.post('/api/entities/9999/departments', { name: 'X' })).status, 404);
  });
});

describe('focal points', () => {
  let s; let dept; let dept2;
  before(async () => {
    s = await startServer();
    const e = (await s.post('/api/entities', { name: 'Entity' })).data;
    dept = (await s.post(`/api/entities/${e.id}/departments`, { name: 'Ops' })).data;
    dept2 = (await s.post(`/api/entities/${e.id}/departments`, { name: 'IT' })).data;
  });
  after(() => s.close());

  const valid = { name: 'Test Person', title: 'Officer', email: 'test.person@example.com', remarks: 'Line one\nLine two' };

  test('create with all fields and multi-line remarks', async () => {
    const r = await s.post(`/api/departments/${dept.id}/focal-points`, valid);
    assert.equal(r.status, 201);
    assert.equal(r.data.focalPoint.remarks, 'Line one\nLine two');
    assert.deepEqual(r.data.duplicateEmails, []);
    assert.ok(r.data.focalPoint.created_at);
  });

  test('remarks are optional; name, title and email are required', async () => {
    const ok = await s.post(`/api/departments/${dept.id}/focal-points`, { ...valid, email: 'second@example.com', remarks: undefined });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.focalPoint.remarks, '');
    for (const field of ['name', 'title', 'email']) {
      const r = await s.post(`/api/departments/${dept.id}/focal-points`, { ...valid, [field]: '' });
      assert.equal(r.status, 400, field);
      assert.equal(r.data.field, field);
    }
  });

  test('email format is validated', async () => {
    for (const email of ['plainaddress', 'a@b', 'a b@example.com', '@example.com', 'a@.com', 'a@example.']) {
      const r = await s.post(`/api/departments/${dept.id}/focal-points`, { ...valid, email });
      assert.equal(r.status, 400, email);
      assert.equal(r.data.field, 'email');
    }
  });

  test('many focal points per department', async () => {
    for (let i = 0; i < 25; i++) {
      const r = await s.post(`/api/departments/${dept2.id}/focal-points`, { ...valid, name: `Person ${i}`, email: `p${i}@example.com` });
      assert.equal(r.status, 201);
    }
    const tree = (await s.get('/api/tree')).data;
    assert.equal(tree[0].departments.find((d) => d.id === dept2.id).focal_points.length, 25);
  });

  test('duplicate email warns but does not block', async () => {
    const r = await s.post(`/api/departments/${dept2.id}/focal-points`, { ...valid, name: 'Other', email: 'TEST.PERSON@example.com' });
    assert.equal(r.status, 201);
    assert.equal(r.data.duplicateEmails.length, 1);
    assert.equal(r.data.duplicateEmails[0].name, 'Test Person');
    assert.equal(r.data.duplicateEmails[0].department, 'Ops');

    const check = await s.get(`/api/email-check?email=${encodeURIComponent('test.person@example.com')}`);
    assert.equal(check.data.duplicates.length, 2);
    const checkExcl = await s.get(`/api/email-check?email=test.person@example.com&excludeId=${r.data.focalPoint.id}`);
    assert.equal(checkExcl.data.duplicates.length, 1);

    const tree = (await s.get('/api/tree?q=test.person')).data;
    const all = tree.flatMap((e) => e.departments.flatMap((d) => d.focal_points));
    assert.ok(all.every((f) => f.email_duplicates === 1));
  });

  test('edit updates fields and updated_at, and can move department', async () => {
    const created = (await s.post(`/api/departments/${dept.id}/focal-points`, { ...valid, email: 'mover@example.com' })).data.focalPoint;
    await new Promise((r) => setTimeout(r, 5));
    const r = await s.put(`/api/focal-points/${created.id}`, { ...valid, title: 'Senior Officer', email: 'mover@example.com', department_id: dept2.id });
    assert.equal(r.status, 200);
    assert.equal(r.data.focalPoint.title, 'Senior Officer');
    assert.equal(r.data.focalPoint.department_id, dept2.id);
    assert.ok(r.data.focalPoint.updated_at > created.updated_at);
    assert.equal((await s.put(`/api/focal-points/${created.id}`, { ...valid, email: 'bad' })).status, 400);
  });

  test('delete a focal point', async () => {
    const created = (await s.post(`/api/departments/${dept.id}/focal-points`, { ...valid, email: 'gone@example.com' })).data.focalPoint;
    assert.equal((await s.del(`/api/focal-points/${created.id}`)).status, 200);
    assert.equal((await s.get(`/api/focal-points/${created.id}`)).status, 404);
  });
});

describe('deletes with contents', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  test('department impact lists focal points, delete cascades', async () => {
    const e = (await s.post('/api/entities', { name: 'E' })).data;
    const d = (await s.post(`/api/entities/${e.id}/departments`, { name: 'D' })).data;
    await s.post(`/api/departments/${d.id}/focal-points`, { name: 'A', title: 'T', email: 'a@example.com' });
    await s.post(`/api/departments/${d.id}/focal-points`, { name: 'B', title: 'T', email: 'b@example.com' });
    const impact = (await s.get(`/api/departments/${d.id}/impact`)).data;
    assert.deepEqual(impact.focalPoints.map((f) => f.name), ['A', 'B']);
    const del = await s.del(`/api/departments/${d.id}`);
    assert.equal(del.data.deleted.focalPoints.length, 2);
    assert.equal((await s.get('/api/stats')).data.focalPoints, 0);
  });

  test('entity impact lists departments and focal points, delete cascades', async () => {
    const e = (await s.post('/api/entities', { name: 'Big' })).data;
    const d1 = (await s.post(`/api/entities/${e.id}/departments`, { name: 'One' })).data;
    await s.post(`/api/entities/${e.id}/departments`, { name: 'Two' });
    await s.post(`/api/departments/${d1.id}/focal-points`, { name: 'X', title: 'T', email: 'x@example.com' });
    const impact = (await s.get(`/api/entities/${e.id}/impact`)).data;
    assert.equal(impact.departments.length, 2);
    assert.equal(impact.departments.find((d) => d.name === 'One').focal_point_count, 1);
    assert.equal(impact.focalPoints.length, 1);
    await s.del(`/api/entities/${e.id}`);
    const stats = (await s.get('/api/stats')).data;
    assert.equal(stats.departments, 0);
    assert.equal(stats.focalPoints, 0);
  });
});

describe('search', () => {
  let s;
  before(async () => {
    s = await startServer({ seed: true });
  });
  after(() => s.close());

  const names = (tree) => tree.flatMap((e) => e.departments.flatMap((d) => d.focal_points.map((f) => f.name)));

  test('by focal point name, case-insensitive, keeps only matching people', async () => {
    const tree = (await s.get('/api/tree?q=OMAR')).data;
    assert.deepEqual(names(tree), ['Omar Fadel']);
    assert.equal(tree[0].name, 'Northwind Health Authority');
  });

  test('by title and email', async () => {
    assert.deepEqual(names((await s.get('/api/tree?q=budget officer')).data), ['Sara Mansour']);
    assert.deepEqual(names((await s.get('/api/tree?q=priya.raman@')).data), ['Priya Raman']);
  });

  test('by department name keeps the whole department', async () => {
    const tree = (await s.get('/api/tree?q=curriculum')).data;
    assert.equal(tree.length, 1);
    assert.equal(tree[0].departments[0].focal_points.length, 3);
  });

  test('Arabic search', async () => {
    const tree = (await s.get(`/api/tree?q=${encodeURIComponent('العمليات')}`)).data;
    assert.equal(tree.length, 1);
    assert.equal(tree[0].name, 'هيئة المثال للنقل');
    assert.equal(tree[0].departments[0].name, 'إدارة العمليات');
  });

  test('no match returns empty list', async () => {
    assert.deepEqual((await s.get('/api/tree?q=zzzz-nothing')).data, []);
  });
});

describe('Arabic and English text', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  test('round-trips unchanged in every field', async () => {
    const e = (await s.post('/api/entities', { name: 'وزارة الاختبار Test' })).data;
    const d = (await s.post(`/api/entities/${e.id}/departments`, { name: 'قسم الجودة / Quality' })).data;
    const fp = (await s.post(`/api/departments/${d.id}/focal-points`, {
      name: 'فاطمة أحمد', title: 'مديرة / Manager', email: 'fatima@example.com', remarks: 'سطر أول\nSecond line',
    })).data.focalPoint;
    const tree = (await s.get('/api/tree')).data;
    assert.equal(tree[0].name, 'وزارة الاختبار Test');
    assert.equal(tree[0].departments[0].name, 'قسم الجودة / Quality');
    assert.equal(fp.name, 'فاطمة أحمد');
    assert.equal(fp.title, 'مديرة / Manager');
    assert.equal(fp.remarks, 'سطر أول\nSecond line');
  });
});

describe('Excel export', () => {
  let s;
  before(async () => { s = await startServer({ seed: true }); });
  after(() => s.close());

  async function readSheet(buf) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Directory');
    const rows = [];
    ws.eachRow((row) => rows.push(row.values.slice(1)));
    return rows;
  }

  test('whole directory, including empty departments', async () => {
    const r = await s.get('/api/export.xlsx');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="users-directory-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const rows = await readSheet(r.data);
    assert.deepEqual(rows[0].slice(0, 6), ['Entity', 'Department', 'Focal Point Name', 'Title', 'Email', 'Remarks']);
    const stats = (await s.get('/api/stats')).data;
    assert.equal(rows.length - 1, stats.focalPoints + 1); // + Procurement (empty department)
    assert.ok(rows.some((row) => row[0] === 'Northwind Health Authority' && row[1] === 'Procurement' && !row[2]));
    assert.ok(rows.some((row) => row[2] === 'خالد الراشد'));
  });

  test('one entity only', async () => {
    const tree = (await s.get('/api/tree')).data;
    const arabic = tree.find((e) => e.name === 'هيئة المثال للنقل');
    const r = await s.get(`/api/export.xlsx?entityId=${arabic.id}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''/);
    const rows = await readSheet(r.data);
    assert.equal(rows.length - 1, 3);
    assert.ok(rows.slice(1).every((row) => row[0] === 'هيئة المثال للنقل'));
  });

  test('missing entity returns 404', async () => {
    assert.equal((await s.get('/api/export.xlsx?entityId=9999')).status, 404);
  });
});

describe('sample data', () => {
  test('is off by default', async () => {
    const s = await startServer();
    assert.equal((await s.get('/api/stats')).data.entities, 0);
    await s.close();
  });

  test('loads into an empty directory when enabled', async () => {
    const s = await startServer({ seed: true });
    const stats = (await s.get('/api/stats')).data;
    assert.equal(stats.entities, 4);
    assert.equal(stats.focalPoints, 11);
    await s.close();
  });

  test('never touches a directory that already has data', async () => {
    const { seedSampleData } = require('../src/seed');
    const s = await startServer();
    await s.post('/api/entities', { name: 'Existing record' });
    const result = await seedSampleData(s.pool);
    assert.equal(result.seeded, false);
    const tree = (await s.get('/api/tree')).data;
    assert.deepEqual(tree.map((e) => e.name), ['Existing record']);
    await s.close();
  });

  test('uses only reserved example domains', () => {
    const { SAMPLE } = require('../src/seed');
    const emails = SAMPLE.flatMap((e) => e.departments.flatMap((d) => d.focal_points.map((f) => f.email)));
    assert.ok(emails.length > 0);
    for (const email of emails) assert.match(email, /\.example\.(com|org)$/);
  });

  test('there is no way to reset data from the app', async () => {
    const s = await startServer();
    assert.equal((await s.post('/api/admin/reset-sample-data')).status, 404);
    await s.close();
  });
});

describe('persistence', () => {
  test('records survive an app restart and re-running migrations', async () => {
    const { createApp, initDatabase } = require('../src/app');
    const s = await startServer({ seed: true });
    await s.post('/api/entities', { name: 'Kept across restarts' });
    // Simulate a new deploy: run start-up again on the same database, with seeding on.
    const result = await initDatabase(s.pool, { seed: true, adminUsername: 'x-admin', adminPassword: 'another-password' });
    assert.equal(result.seeded, false);
    assert.equal(result.adminCreated, false);
    createApp(s.pool);
    const names = (await s.get('/api/tree')).data.map((e) => e.name);
    assert.ok(names.includes('Kept across restarts'));
    assert.equal(names.length, 5);
    await s.close();
  });
});

describe('web app', () => {
  test('serves the interface with security headers', async () => {
    const s = await startServer();
    const r = await s.get('/');
    assert.equal(r.status, 200);
    assert.match(r.data.toString(), /<meta name="viewport"/);
    assert.match(r.data.toString(), /charset="utf-8"/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal((await s.get('/app.js')).status, 200);
    assert.equal((await s.get('/api/nope')).status, 404);
    await s.close();
  });

  test('health check reports no data', async () => {
    const s = await startServer({ seed: true });
    const r = await s.client().get('/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
    await s.close();
  });

  test('invalid JSON returns 400', async () => {
    const s = await startServer();
    const res = await fetch(`${s.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(res.status, 400);
    await s.close();
  });
});
