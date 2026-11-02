// ─────────────────────────────────────────────────────────────
// BlueBeakend — End-to-End Integration Tests
// Tests Backend API, Realtime WebSocket, Admin API & @bluebeakend/js SDK
// ─────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin@bluebeakend.local';
process.env.ADMIN_PASSWORD = 'AdminSecretPassword123!';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef';

const { buildApp } = await import('../src/app.js');
const { outbox } = await import('../src/utils/mailer.js');
const { Bluebeakend } = await import('../../sdk/js/src/index.js');

let app;
let baseUrl;
let apiKey;
let tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bb-test-'));
  process.env.BACKUPS_DIR = join(tmpDir, 'backups');
  app = await buildApp({
    forceMemory: true,
    forceLocal: true,
    storageDir: join(tmpDir, 'storage'),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  apiKey = app.bb.bootInfo.apiKey;
});

after(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

test('Health endpoints work without X-API-Key', async () => {
  const r1 = await fetch(`${baseUrl}/healthz`);
  assert.equal(r1.status, 200);
  assert.equal(await r1.text(), 'OK');

  const r2 = await fetch(`${baseUrl}/health`);
  assert.equal(r2.status, 200);
  const body = await r2.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.version, '1.0.0');
  assert.equal(body.services.database.ok, true);
});

test('Endpoints reject missing or invalid X-API-Key', async () => {
  const r1 = await fetch(`${baseUrl}/api/v1/db/todos`);
  assert.equal(r1.status, 401);

  const r2 = await fetch(`${baseUrl}/api/v1/db/todos`, {
    headers: { 'X-API-Key': 'invalid-key' },
  });
  assert.equal(r2.status, 401);
});

test('Auth register, login, profile, sessions, refresh, password reset & logout', async () => {
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

  // Register
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'alice@example.com', password: 'password123', name: 'Alice' }),
  });
  assert.equal(regRes.status, 201);
  const reg = await regRes.json();
  assert.equal(reg.user.email, 'alice@example.com');
  assert.ok(reg.accessToken);
  assert.ok(reg.refreshToken);

  // Duplicate email -> 409
  const dupRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'alice@example.com', password: 'password123' }),
  });
  assert.equal(dupRes.status, 409);

  // /me & PATCH /me
  const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { ...headers, Authorization: `Bearer ${reg.accessToken}` },
  });
  assert.equal(meRes.status, 200);
  assert.equal((await meRes.json()).user.name, 'Alice');

  const patchRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    method: 'PATCH',
    headers: { ...headers, Authorization: `Bearer ${reg.accessToken}` },
    body: JSON.stringify({ name: 'Alice Cooper', metadata: { tier: 'pro' } }),
  });
  assert.equal(patchRes.status, 200);
  assert.equal((await patchRes.json()).user.name, 'Alice Cooper');

  // Sessions
  const sessRes = await fetch(`${baseUrl}/api/v1/auth/sessions`, {
    headers: { ...headers, Authorization: `Bearer ${reg.accessToken}` },
  });
  assert.equal(sessRes.status, 200);
  const { sessions } = await sessRes.json();
  assert.equal(sessions.length, 1);

  // Refresh token rotation
  const refRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ refreshToken: reg.refreshToken }),
  });
  assert.equal(refRes.status, 200);
  const rotated = await refRes.json();
  assert.ok(rotated.refreshToken !== reg.refreshToken);

  // Old refresh token can no longer be reused
  const reuseRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ refreshToken: reg.refreshToken }),
  });
  assert.equal(reuseRes.status, 401);

  // Password forgot + reset via captured outbox token
  outbox.length = 0;
  const forgotRes = await fetch(`${baseUrl}/api/v1/auth/password/forgot`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'alice@example.com' }),
  });
  assert.equal(forgotRes.status, 200);
  assert.equal(outbox.length, 1);
  const tokenMatch = outbox[0].text.match(/Reset token:\s*([0-9a-f]+)/i);
  assert.ok(tokenMatch, 'expected reset token in captured email');

  const resetRes = await fetch(`${baseUrl}/api/v1/auth/password/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: tokenMatch[1], newPassword: 'newPassword456!' }),
  });
  assert.equal(resetRes.status, 200);

  // Login with new password
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'alice@example.com', password: 'newPassword456!' }),
  });
  assert.equal(loginRes.status, 200);
  const loggedIn = await loginRes.json();

  // Logout
  const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ refreshToken: loggedIn.refreshToken }),
  });
  assert.equal(logoutRes.status, 200);
});

test('Database CRUD, queries, count & batch operations', async () => {
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

  // Batch create
  const batchRes = await fetch(`${baseUrl}/api/v1/db/tasks/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ops: [
        { op: 'create', data: { title: 'Task A', priority: 1, done: false, tags: ['urgent', 'backend'] } },
        { op: 'create', data: { title: 'Task B', priority: 2, done: false, tags: ['ui'] } },
        { op: 'create', data: { title: 'Task C', priority: 3, done: true, tags: ['docs'] } },
      ],
    }),
  });
  assert.equal(batchRes.status, 200);
  const { results } = await batchRes.json();
  assert.equal(results.length, 3);
  const idA = results[0].doc._id;

  // Compact query string filter + orderBy
  const listRes = await fetch(`${baseUrl}/api/v1/db/tasks?where=done==false,priority>=1&orderBy=priority:desc`, { headers });
  assert.equal(listRes.status, 200);
  const listed = await listRes.json();
  assert.equal(listed.total, 2);
  assert.equal(listed.docs[0].title, 'Task B');

  // Structured POST /query with contains & select
  const qRes = await fetch(`${baseUrl}/api/v1/db/tasks/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      where: [['tags', 'contains', 'urgent']],
      select: ['title'],
      count: true,
    }),
  });
  const qData = await qRes.json();
  assert.equal(qData.count, 1);
  assert.equal(qData.docs[0].title, 'Task A');
  assert.equal(qData.docs[0].priority, undefined);

  // Count
  const cntRes = await fetch(`${baseUrl}/api/v1/db/tasks/count?where=done==true`, { headers });
  assert.equal((await cntRes.json()).count, 1);

  // PATCH, PUT, DELETE
  const patchRes = await fetch(`${baseUrl}/api/v1/db/tasks/${idA}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ done: true }),
  });
  assert.equal((await patchRes.json()).doc.done, true);

  const putRes = await fetch(`${baseUrl}/api/v1/db/tasks/${idA}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ title: 'Replaced Task A', done: true }),
  });
  const replaced = (await putRes.json()).doc;
  assert.equal(replaced.title, 'Replaced Task A');
  assert.equal(replaced.priority, undefined);

  const delRes = await fetch(`${baseUrl}/api/v1/db/tasks/${idA}`, { method: 'DELETE', headers });
  assert.equal(delRes.status, 200);
});

test('@bluebeakend/js SDK: signup, login, db, storage & realtime onSnapshot', async () => {
  const bb = new Bluebeakend({
    apiKey,
    baseUrl,
    projectId: 'sdk-e2e',
  });

  await bb.auth.signup('sdk@example.com', 'pass12345', 'SDK Tester');
  const loginRes = await bb.auth.login('sdk@example.com', 'pass12345');
  assert.equal(loginRes.user.email, 'sdk@example.com');

  // Subscribe to realtime changes BEFORE mutating todos
  const events = [];
  let resolveCreated;
  const createdPromise = new Promise((r) => { resolveCreated = r; });

  const unsub = bb.db.collection('todos').onSnapshot((change) => {
    events.push(change);
    if (change.type === 'doc.updated') resolveCreated(change);
  });

  // Give WebSocket subscription a brief moment to register
  await new Promise((r) => setTimeout(r, 120));

  const doc = await bb.db.collection('todos').add({ title: 'Buy milk', done: false });
  assert.ok(doc.id);
  assert.equal(doc.title, 'Buy milk');

  const list = await bb.db.collection('todos').where('done', '==', false).get();
  assert.equal(list.total, 1);
  assert.equal(list.docs[0].id, doc.id);

  const updated = await bb.db.collection('todos').doc(doc.id).update({ done: true });
  assert.equal(updated.done, true);

  // Verify realtime event arrived
  const change = await Promise.race([
    createdPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Realtime timeout')), 3000)),
  ]);
  assert.equal(change.doc.done, true);
  unsub();
  bb.realtime.disconnect();

  // Storage upload + signed download via SDK
  const uploaded = await bb.storage.upload('Hello BlueBeakend Storage!', {
    name: 'greeting.txt',
    folder: 'notes',
    mime: 'text/plain',
  });
  assert.ok(uploaded.id);
  assert.equal(uploaded.folder, 'notes');

  const signedUrl = await bb.storage.getUrl(uploaded.id);
  const dlRes = await fetch(signedUrl);
  assert.equal(dlRes.status, 200);
  assert.equal(await dlRes.text(), 'Hello BlueBeakend Storage!');
});

test('Admin API: login, stats, users, apikeys, collections, backups & logs', async () => {
  const loginRes = await fetch(`${baseUrl}/api/v1/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@bluebeakend.local',
      password: 'AdminSecretPassword123!',
    }),
  });
  assert.equal(loginRes.status, 200);
  const { accessToken } = await loginRes.json();
  const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // Stats
  const statsRes = await fetch(`${baseUrl}/api/v1/admin/stats`, { headers: authHeaders });
  assert.equal(statsRes.status, 200);
  const statsBody = await statsRes.json();
  assert.ok(statsBody.stats.users >= 3);
  assert.equal(statsBody.requestsLast7Days.length, 7);
  assert.ok(Array.isArray(statsBody.recentActivity));

  // Create API key & get Firebase-style config
  const keyRes = await fetch(`${baseUrl}/api/v1/admin/apikeys`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'my-flutter-app' }),
  });
  assert.equal(keyRes.status, 201);
  const createdKey = await keyRes.json();
  assert.match(createdKey.apiKey, /^bb_live_[0-9a-f]{40}$/);
  assert.equal(createdKey.config.projectId, 'my-flutter-app');

  // Backup create & restore
  const bkRes = await fetch(`${baseUrl}/api/v1/admin/backups`, { method: 'POST', headers: authHeaders });
  assert.equal(bkRes.status, 201);
  const { backup } = await bkRes.json();

  const restoreRes = await fetch(`${baseUrl}/api/v1/admin/backups/${backup.name}/restore`, {
    method: 'POST',
    headers: authHeaders,
  });
  assert.equal(restoreRes.status, 200);

  // Swagger OpenAPI spec
  const oaRes = await fetch(`${baseUrl}/openapi.json`);
  assert.equal(oaRes.status, 200);
  const oa = await oaRes.json();
  assert.equal(oa.openapi, '3.0.3');
});
