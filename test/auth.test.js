'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ADMIN } = require('./helpers');
const { hashPassword, verifyPassword, createThrottle } = require('../src/auth');

describe('passwords', () => {
  test('are hashed with a salt and verified', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    assert.notEqual(a, b);
    assert.ok(!a.includes('correct horse battery'));
    assert.equal(await verifyPassword('correct horse battery', a), true);
    assert.equal(await verifyPassword('wrong password!!', a), false);
  });
});

describe('sign in', () => {
  let s;
  before(async () => { s = await startServer({ seed: true }); });
  after(() => s.close());

  test('nothing is readable without signing in', async () => {
    const anon = s.client();
    for (const path of ['/api/tree', '/api/stats', '/api/export.xlsx', '/api/focal-points/1', '/api/email-check?email=a@b.com', '/api/users', '/api/me']) {
      const r = await anon.get(path);
      assert.equal(r.status, 401, path);
      assert.ok(!JSON.stringify(r.data).includes('@'), `${path} leaked data`);
    }
    assert.equal((await anon.post('/api/entities', { name: 'x' })).status, 401);
  });

  test('wrong password or unknown user is refused with the same message', async () => {
    const anon = s.client();
    const a = await anon.login(ADMIN.username, 'not-the-password');
    const b = await anon.login('nobody-here', 'not-the-password');
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.data.error, b.data.error);
    assert.equal(anon.cookie, '');
  });

  test('correct login sets a secure session cookie; logout ends it', async () => {
    const c = s.client();
    const r = await c.login(ADMIN.username.toUpperCase(), ADMIN.password);
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'admin');
    assert.equal(r.data.user.password_hash, undefined);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal((await c.get('/api/tree')).status, 200);
    const token = c.cookie;
    await c.post('/api/logout');
    assert.equal((await c.get('/api/tree')).status, 401);
    // The old cookie is dead on the server too, not just cleared in the browser.
    assert.equal((await s.client().get('/api/tree', { Cookie: token })).status, 401);
  });

  test('a forged session cookie does not work', async () => {
    assert.equal((await s.client().get('/api/tree', { Cookie: 'ud_session=forged-token' })).status, 401);
  });

  test('cross-site write requests are refused', async () => {
    const r = await s.post('/api/entities', { name: 'From evil site' }, { Origin: 'https://evil.example.com' });
    assert.equal(r.status, 403);
  });

  test('setup is reported only when there are no users', async () => {
    assert.equal((await s.client().get('/api/config')).data.setupRequired, false);
  });
});

describe('login throttling', () => {
  test('locks a username after 5 failures', () => {
    const t = createThrottle();
    for (let i = 0; i < 5; i++) t.fail('1.1.1.1', 'bob');
    assert.equal(t.blocked('1.1.1.1', 'bob'), true);
    assert.equal(t.blocked('2.2.2.2', 'alice'), false);
  });

  test('the API refuses further attempts, even with the right password', async () => {
    const s = await startServer();
    const c = s.client();
    for (let i = 0; i < 5; i++) await c.login(ADMIN.username, 'wrong-password-123');
    const r = await c.login(ADMIN.username, ADMIN.password);
    assert.equal(r.status, 429);
    await s.close();
  });
});

describe('roles', () => {
  let s; let viewer; let editor; let entity; let dept;
  before(async () => {
    s = await startServer();
    await s.post('/api/users', { username: 'viewer1', password: 'viewer-password', role: 'viewer' });
    await s.post('/api/users', { username: 'editor1', password: 'editor-password', role: 'editor' });
    viewer = s.client(); await viewer.login('viewer1', 'viewer-password');
    editor = s.client(); await editor.login('editor1', 'editor-password');
    entity = (await s.post('/api/entities', { name: 'Role Test' })).data;
    dept = (await s.post(`/api/entities/${entity.id}/departments`, { name: 'Dept' })).data;
  });
  after(() => s.close());

  test('viewer can read and export but not change anything', async () => {
    assert.equal((await viewer.get('/api/tree')).status, 200);
    assert.equal((await viewer.get('/api/export.xlsx')).status, 200);
    assert.equal((await viewer.post('/api/entities', { name: 'No' })).status, 403);
    assert.equal((await viewer.put(`/api/entities/${entity.id}`, { name: 'No' })).status, 403);
    assert.equal((await viewer.del(`/api/entities/${entity.id}`)).status, 403);
    assert.equal((await viewer.post(`/api/departments/${dept.id}/focal-points`, { name: 'a', title: 'b', email: 'c@example.com' })).status, 403);
    assert.equal((await viewer.get('/api/users')).status, 403);
  });

  test('editor can change the directory but not manage users', async () => {
    const fp = await editor.post(`/api/departments/${dept.id}/focal-points`, { name: 'A', title: 'B', email: 'a@example.com' });
    assert.equal(fp.status, 201);
    assert.equal((await editor.put(`/api/departments/${dept.id}`, { name: 'Dept 2' })).status, 200);
    assert.equal((await editor.del(`/api/focal-points/${fp.data.focalPoint.id}`)).status, 200);
    assert.equal((await editor.get('/api/users')).status, 403);
    assert.equal((await editor.post('/api/users', { username: 'sneaky', password: 'sneaky-password', role: 'admin' })).status, 403);
  });

  test('/api/me reports the role', async () => {
    assert.equal((await viewer.get('/api/me')).data.user.role, 'viewer');
    assert.equal((await editor.get('/api/me')).data.user.role, 'editor');
  });
});

describe('user management', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  test('admin creates, lists, updates and deletes users; hashes are never returned', async () => {
    const created = await s.post('/api/users', { username: 'new.user', display_name: 'New User', password: 'new-user-password', role: 'viewer' });
    assert.equal(created.status, 201);
    assert.equal(created.data.password_hash, undefined);
    const list = (await s.get('/api/users')).data;
    assert.deepEqual(list.map((u) => u.username).sort(), ['new.user', ADMIN.username]);
    assert.ok(list.every((u) => u.password_hash === undefined));
    const updated = await s.put(`/api/users/${created.data.id}`, { role: 'editor' });
    assert.equal(updated.data.role, 'editor');
    assert.equal((await s.del(`/api/users/${created.data.id}`)).status, 200);
  });

  test('validates username, role, password length and uniqueness', async () => {
    assert.equal((await s.post('/api/users', { username: 'ab', password: 'long-enough-pass', role: 'viewer' })).data.field, 'username');
    assert.equal((await s.post('/api/users', { username: 'valid.name', password: 'long-enough-pass', role: 'owner' })).data.field, 'role');
    assert.equal((await s.post('/api/users', { username: 'valid.name', password: 'short', role: 'viewer' })).data.field, 'password');
    assert.equal((await s.post('/api/users', { username: 'dupe', password: 'long-enough-pass', role: 'viewer' })).status, 201);
    assert.equal((await s.post('/api/users', { username: 'DUPE', password: 'long-enough-pass', role: 'viewer' })).status, 409);
  });

  test('deactivating a user or resetting their password signs them out', async () => {
    const u = (await s.post('/api/users', { username: 'temp1', password: 'temp-password-1', role: 'editor' })).data;
    const c = s.client();
    await c.login('temp1', 'temp-password-1');
    assert.equal((await c.get('/api/tree')).status, 200);
    await s.put(`/api/users/${u.id}`, { password: 'reset-password-2' });
    assert.equal((await c.get('/api/tree')).status, 401);
    assert.equal((await c.login('temp1', 'temp-password-1')).status, 401);
    assert.equal((await c.login('temp1', 'reset-password-2')).status, 200);
    await s.put(`/api/users/${u.id}`, { active: false });
    assert.equal((await c.get('/api/tree')).status, 401);
    assert.equal((await c.login('temp1', 'reset-password-2')).status, 401);
  });

  test('the last admin cannot be removed, demoted or deactivated', async () => {
    const me = (await s.get('/api/me')).data.user;
    assert.equal((await s.put(`/api/users/${me.id}`, { role: 'viewer' })).status, 400);
    assert.equal((await s.put(`/api/users/${me.id}`, { active: false })).status, 400);
    assert.equal((await s.del(`/api/users/${me.id}`)).status, 400);
    // With a second admin, the first can be demoted by the second.
    await s.post('/api/users', { username: 'admin2', password: 'admin2-password', role: 'admin' });
    const other = s.client();
    await other.login('admin2', 'admin2-password');
    assert.equal((await other.put(`/api/users/${me.id}`, { role: 'editor' })).status, 200);
    assert.equal((await other.put(`/api/users/${me.id}`, { role: 'admin' })).status, 200);
    // A role change signs that user out everywhere.
    assert.equal((await s.get('/api/tree')).status, 401);
    await s.login(ADMIN.username, ADMIN.password);
  });

  test('users change their own password with the current one', async () => {
    await s.post('/api/users', { username: 'selfserve', password: 'first-password-1', role: 'viewer' });
    const c = s.client();
    const l = await c.login('selfserve', 'first-password-1');
    assert.equal(l.status, 200, JSON.stringify(l.data));
    assert.equal((await c.post('/api/me/password', { current_password: 'wrong-one-here', new_password: 'second-password-2' })).status, 400);
    assert.equal((await c.post('/api/me/password', { current_password: 'first-password-1', new_password: 'second-password-2' })).status, 200);
    assert.equal((await s.client().login('selfserve', 'second-password-2')).status, 200);
  });
});

describe('first admin', () => {
  test('without ADMIN_USERNAME/ADMIN_PASSWORD there are no users and setup is reported', async () => {
    const s = await startServer({ adminUsername: '', adminPassword: '', login: false });
    assert.equal((await s.get('/api/config')).data.setupRequired, true);
    assert.equal((await s.get('/api/tree')).status, 401);
    await s.close();
  });
});
