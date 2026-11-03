// ─────────────────────────────────────────────────────────────
// BlueBeakend — Built-in S3-compatible Object Storage Server
// Replaces discontinued Docker Hub `minio/minio` image while
// speaking the S3 REST XML/binary protocol on port 9000 backed
// by `/data` (`miniodata` Docker volume).
// ─────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, stat, readdir } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('minio-s3');

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function s3Error(res, status, code, message) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${xmlEscape(code)}</Code>
  <Message>${xmlEscape(message)}</Message>
</Error>`;
  res.writeHead(status, {
    'Content-Type': 'application/xml',
    'Content-Length': Buffer.byteLength(xml),
  });
  res.end(xml);
}

function extractAccessKey(req, urlObj) {
  // Header: Authorization: AWS4-HMAC-SHA256 Credential=ACCESS_KEY/20261103/us-east-1/s3/aws4_request, ...
  const auth = req.headers.authorization || '';
  const m = auth.match(/Credential=([^/,\s]+)\//);
  if (m) return m[1];
  // Presigned query: ?X-Amz-Credential=ACCESS_KEY%2F...
  const qCred = urlObj.searchParams.get('X-Amz-Credential');
  if (qCred) return qCred.split('/')[0];
  return null;
}

function safeResolve(root, ...segments) {
  const base = resolve(root);
  const target = resolve(base, ...segments.map((s) => s.replace(/^\/+/, '')));
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('Path traversal blocked');
  }
  return target;
}

async function walkFiles(dir, prefix = '') {
  const results = [];
  const walk = async (cur, rel) => {
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const fullPath = join(cur, e.name);
      if (e.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (!e.name.endsWith('.s3meta.json')) {
        if (!prefix || relPath.startsWith(prefix)) {
          const st = await stat(fullPath).catch(() => null);
          if (st) results.push({ key: relPath, size: st.size, mtime: st.mtime });
        }
      }
    }
  };
  await walk(dir, '');
  results.sort((a, b) => a.key.localeCompare(b.key));
  return results;
}

export async function startS3Server({
  dataDir = process.env.MINIO_DATA_DIR || '/data',
  port = Number(process.env.S3_PORT || process.env.PORT || 9000),
  host = process.env.HOST || '0.0.0.0',
  accessKey = process.env.MINIO_ROOT_USER || 'bluebeakend',
  secretKey = process.env.MINIO_ROOT_PASSWORD || '',
  defaultBucket = process.env.MINIO_BUCKET || 'bluebeakend',
} = {}) {
  await mkdir(dataDir, { recursive: true });
  if (defaultBucket) {
    await mkdir(safeResolve(dataDir, defaultBucket), { recursive: true });
  }

  const server = createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(urlObj.pathname);

      // Unauthenticated health probes
      if (pathname === '/healthz' || pathname === '/minio/health/live' || pathname === '/minio/health/ready') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }

      // Verify S3 access key when configured
      if (accessKey && secretKey) {
        const providedKey = extractAccessKey(req, urlObj);
        if (providedKey !== accessKey) {
          return s3Error(res, 403, 'AccessDenied', 'Invalid S3 access key');
        }
      }

      const parts = pathname.replace(/^\/+/, '').split('/');
      const bucket = parts[0] || '';
      const key = parts.slice(1).join('/');

      // GET / — list all buckets
      if (!bucket && req.method === 'GET') {
        const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
        const bucketsXml = entries
          .filter((e) => e.isDirectory())
          .map((e) => `<Bucket><Name>${xmlEscape(e.name)}</Name><CreationDate>${new Date().toISOString()}</CreationDate></Bucket>`)
          .join('');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Buckets>${bucketsXml}</Buckets>
</ListAllMyBucketsResult>`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(xml);
        return;
      }

      if (!bucket) return s3Error(res, 400, 'InvalidBucketName', 'Bucket name required');
      const bucketDir = safeResolve(dataDir, bucket);

      // Bucket-level operations (no object key)
      if (!key) {
        // Bucket location query (?location) — Minio.Client queries this to discover region!
        if (req.method === 'GET' && urlObj.searchParams.has('location')) {
          const st = await stat(bucketDir).catch(() => null);
          if (!st || !st.isDirectory()) return s3Error(res, 404, 'NoSuchBucket', 'The specified bucket does not exist');
          const xml = `<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>`;
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          res.end(xml);
          return;
        }

        // HEAD /:bucket — bucketExists
        if (req.method === 'HEAD') {
          const st = await stat(bucketDir).catch(() => null);
          if (!st || !st.isDirectory()) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { 'x-amz-bucket-region': 'us-east-1' });
          res.end();
          return;
        }

        // PUT /:bucket — makeBucket
        if (req.method === 'PUT') {
          // Drain optional CreateBucketConfiguration XML body
          for await (const _ of req) { /* drain */ }
          await mkdir(bucketDir, { recursive: true });
          res.writeHead(200, { Location: `/${bucket}` });
          res.end();
          return;
        }

        // DELETE /:bucket
        if (req.method === 'DELETE') {
          res.writeHead(204);
          res.end();
          return;
        }

        // GET /:bucket — listObjects / listObjectsV2
        if (req.method === 'GET') {
          const st = await stat(bucketDir).catch(() => null);
          if (!st || !st.isDirectory()) return s3Error(res, 404, 'NoSuchBucket', 'The specified bucket does not exist');
          const prefix = urlObj.searchParams.get('prefix') || '';
          const maxKeys = Math.min(Number(urlObj.searchParams.get('max-keys') || 1000), 5000);
          const items = (await walkFiles(bucketDir, prefix)).slice(0, maxKeys);
          const contentsXml = items
            .map((it) => {
              const etag = `"${createHash('md5').update(`${it.key}:${it.size}:${it.mtime.getTime()}`).digest('hex')}"`;
              return `<Contents>
    <Key>${xmlEscape(it.key)}</Key>
    <LastModified>${it.mtime.toISOString()}</LastModified>
    <ETag>${xmlEscape(etag)}</ETag>
    <Size>${it.size}</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>`;
            })
            .join('\n  ');
          const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${xmlEscape(bucket)}</Name>
  <Prefix>${xmlEscape(prefix)}</Prefix>
  <KeyCount>${items.length}</KeyCount>
  <MaxKeys>${maxKeys}</MaxKeys>
  <IsTruncated>false</IsTruncated>
  ${contentsXml}
</ListBucketResult>`;
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          res.end(xml);
          return;
        }
      }

      // Object-level operations (/:bucket/:key)
      const objPath = safeResolve(bucketDir, key);
      const metaPath = `${objPath}.s3meta.json`;

      if (req.method === 'PUT') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        await mkdir(dirname(objPath), { recursive: true });
        await writeFile(objPath, body);
        const contentType = req.headers['content-type'] || 'application/octet-stream';
        const etag = createHash('md5').update(body).digest('hex');
        await writeFile(metaPath, JSON.stringify({ contentType, etag }));
        res.writeHead(200, { ETag: `"${etag}"` });
        res.end();
        return;
      }

      if (req.method === 'HEAD') {
        const st = await stat(objPath).catch(() => null);
        if (!st || !st.isFile()) {
          res.writeHead(404);
          res.end();
          return;
        }
        let meta = { contentType: 'application/octet-stream', etag: '' };
        try { meta = JSON.parse(await readFile(metaPath, 'utf8')); } catch { /* default */ }
        res.writeHead(200, {
          'Content-Type': meta.contentType,
          'Content-Length': String(st.size),
          'Last-Modified': st.mtime.toUTCString(),
          ETag: `"${meta.etag || st.size}"`,
        });
        res.end();
        return;
      }

      if (req.method === 'GET') {
        const st = await stat(objPath).catch(() => null);
        if (!st || !st.isFile()) return s3Error(res, 404, 'NoSuchKey', 'The specified key does not exist');
        let meta = { contentType: 'application/octet-stream', etag: '' };
        try { meta = JSON.parse(await readFile(metaPath, 'utf8')); } catch { /* default */ }
        const data = await readFile(objPath);
        res.writeHead(200, {
          'Content-Type': meta.contentType,
          'Content-Length': String(data.length),
          'Last-Modified': st.mtime.toUTCString(),
          ETag: `"${meta.etag || data.length}"`,
        });
        res.end(data);
        return;
      }

      if (req.method === 'DELETE') {
        await unlink(objPath).catch(() => {});
        await unlink(metaPath).catch(() => {});
        res.writeHead(204);
        res.end();
        return;
      }

      return s3Error(res, 405, 'MethodNotAllowed', `Unsupported method ${req.method}`);
    } catch (err) {
      log.error(`S3 error: ${err.message}`);
      return s3Error(res, 500, 'InternalError', err.message);
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => resolvePromise());
  });

  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  log.info(`BlueBeakend S3 storage service listening on http://${host}:${boundPort} (data: ${dataDir})`);
  return { server, port: boundPort, close: () => new Promise((r) => server.close(() => r())) };
}
