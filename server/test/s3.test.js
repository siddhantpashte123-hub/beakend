// ─────────────────────────────────────────────────────────────
// BlueBeakend — Built-in S3 Server + MinioStorage Client Test
// Verifies that the S3-compatible microservice (ROLE=minio) works
// seamlessly with the official `minio` v8 S3v4 client.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';

const { startS3Server } = await import('../src/s3/server.js');
const { MinioStorage } = await import('../src/storage/index.js');
const { buildApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');

let s3;
let tmpDir;
let endpoint;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bb-s3-'));
  s3 = await startS3Server({
    dataDir: tmpDir,
    port: 0,
    host: '127.0.0.1',
    accessKey: 'bluebeakend',
    secretKey: 'super-secret-s3-password-123456',
    defaultBucket: 'bluebeakend',
  });
  endpoint = `http://127.0.0.1:${s3.port}`;
});

after(async () => {
  await s3.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

test('S3 server health probes return 200 OK', async () => {
  const r1 = await fetch(`${endpoint}/minio/health/live`);
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${endpoint}/healthz`);
  assert.equal(r2.status, 200);
});

test('MinioStorage (minio v8 S3v4 client) full CRUD against built-in S3 server', async () => {
  const store = new MinioStorage({
    endpoint,
    accessKey: 'bluebeakend',
    secretKey: 'super-secret-s3-password-123456',
    bucket: 'project-files',
    region: 'us-east-1',
  });

  // Creates new bucket via S3 PUT /:bucket
  await store.init();

  const payload = Buffer.from('Hello S3-compatible BlueBeakend Object Store!');
  await store.put('users/u1/avatar.txt', payload, { mime: 'text/plain' });

  const st = await store.stat('users/u1/avatar.txt');
  assert.ok(st);
  assert.equal(st.size, payload.length);

  const got = await store.get('users/u1/avatar.txt');
  assert.ok(got);
  assert.equal(got.toString('utf8'), payload.toString('utf8'));

  const listed = await store.list('users/');
  assert.deepEqual(listed, ['users/u1/avatar.txt']);

  const bytes = await store.usedBytes();
  assert.equal(bytes, payload.length);

  const deleted = await store.delete('users/u1/avatar.txt');
  assert.equal(deleted, true);

  const missing = await store.get('users/u1/avatar.txt');
  assert.equal(missing, null);
});

test('S3 server rejects wrong access key with 403', async () => {
  const bad = new MinioStorage({
    endpoint,
    accessKey: 'wrong-key',
    secretKey: 'wrong-secret',
    bucket: 'project-files',
    region: 'us-east-1',
  });
  await assert.rejects(() => bad.init());
});

test('Full Fastify API storage upload & signed download backed by S3 server', async () => {
  const prevS3 = { ...config.s3 };
  config.s3.endpoint = endpoint;
  config.s3.accessKey = 'bluebeakend';
  config.s3.secretKey = 'super-secret-s3-password-123456';
  config.s3.bucket = 'bluebeakend';
  const testKey = 'bb_live_' + 'a'.repeat(40);
  process.env.API_KEY = testKey;

  const app = await buildApp({ forceMemory: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const apiBase = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const healthRes = await fetch(`${apiBase}/health`);
    const health = await healthRes.json();
    assert.equal(health.services.storage.kind, 'minio');

    const form = new FormData();
    form.append('folder', 'docs');
    form.append('file', new Blob(['PDF-bytes-12345'], { type: 'application/pdf' }), 'report.pdf');

    const upRes = await fetch(`${apiBase}/api/v1/storage/upload`, {
      method: 'POST',
      headers: { 'X-API-Key': testKey },
      body: form,
    });
    assert.equal(upRes.status, 201);
    const { file } = await upRes.json();
    assert.ok(file.id);

    // Metadata & download endpoints return public API signed URLs (not internal minio:9000)
    const metaRes = await fetch(`${apiBase}/api/v1/storage/${file.id}/download`, {
      headers: { 'X-API-Key': testKey },
    });
    assert.equal(metaRes.status, 200);
    const meta = await metaRes.json();
    assert.ok(meta.url.includes(`/api/v1/storage/${file.id}/download?exp=`));

    // Signed download URL works without X-API-Key (browser-friendly)
    const dlPath = new URL(meta.url).pathname + new URL(meta.url).search;
    const dlRes = await fetch(`${apiBase}${dlPath}`);
    assert.equal(dlRes.status, 200);
    assert.equal(await dlRes.text(), 'PDF-bytes-12345');
  } finally {
    Object.assign(config.s3, prevS3);
    await app.close();
  }
});
