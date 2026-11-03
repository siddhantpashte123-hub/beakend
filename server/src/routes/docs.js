// ─────────────────────────────────────────────────────────────
// BlueBeakend — OpenAPI 3.0 spec (/openapi.json) + Swagger UI (/docs)
// Uses local swagger-ui-dist assets so it works 100% offline.
// ─────────────────────────────────────────────────────────────
import fastifyStatic from '@fastify/static';
import swaggerUiDist from 'swagger-ui-dist';
import { config } from '../config.js';
import { originFromReq } from './storage.js';

export function buildOpenApiSpec(serverUrl) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'BlueBeakend API',
      version: config.version,
      description: 'Self-Hosted Firebase Alternative — Auth, Document Database, Object Storage, Realtime WebSocket & Admin API.',
      license: { name: 'MIT' },
    },
    servers: [{ url: serverUrl, description: 'Current BlueBeakend instance' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Project API key (e.g. bb_live_...)',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    tags: [
      { name: 'Health', description: 'Liveness & service health checks' },
      { name: 'Auth', description: 'User registration, login, sessions & password reset' },
      { name: 'Database', description: 'Firestore-style document collections, queries & batches' },
      { name: 'Storage', description: 'S3/MinIO object uploads, folders & signed URLs' },
      { name: 'Admin', description: 'Platform administration (requires admin Bearer JWT)' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          security: [],
          summary: 'Detailed health check',
          responses: { 200: { description: 'Service status & version' } },
        },
      },
      '/healthz': {
        get: {
          tags: ['Health'],
          security: [],
          summary: 'Simple 200 OK probe',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/v1/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', example: 'user@example.com' },
                    password: { type: 'string', example: 'secret123' },
                    name: { type: 'string', example: 'Ada Lovelace' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'User + accessToken + refreshToken' } },
        },
      },
      '/api/v1/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Sign in with email & password',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', example: 'user@example.com' },
                    password: { type: 'string', example: 'secret123' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Tokens + user profile' } },
        },
      },
      '/api/v1/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Rotate refresh token for a new accessToken',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Rotated tokens' } },
        },
      },
      '/api/v1/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Invalidate refresh token',
          responses: { 200: { description: 'Logged out' } },
        },
      },
      '/api/v1/auth/me': {
        get: {
          tags: ['Auth'],
          security: [{ ApiKeyAuth: [], BearerAuth: [] }],
          summary: 'Get current user profile',
          responses: { 200: { description: 'Current user' } },
        },
        patch: {
          tags: ['Auth'],
          security: [{ ApiKeyAuth: [], BearerAuth: [] }],
          summary: 'Update current user profile or password',
          responses: { 200: { description: 'Updated user' } },
        },
      },
      '/api/v1/auth/password/forgot': {
        post: {
          tags: ['Auth'],
          summary: 'Send password reset email',
          responses: { 200: { description: 'Reset link dispatched' } },
        },
      },
      '/api/v1/auth/password/reset': {
        post: {
          tags: ['Auth'],
          summary: 'Reset password using token',
          responses: { 200: { description: 'Password updated' } },
        },
      },
      '/api/v1/auth/verify-email': {
        post: {
          tags: ['Auth'],
          summary: 'Verify user email with token',
          responses: { 200: { description: 'Verified' } },
        },
      },
      '/api/v1/auth/sessions': {
        get: {
          tags: ['Auth'],
          security: [{ ApiKeyAuth: [], BearerAuth: [] }],
          summary: 'List active sessions',
          responses: { 200: { description: 'Active sessions' } },
        },
      },
      '/api/v1/auth/sessions/{id}': {
        delete: {
          tags: ['Auth'],
          security: [{ ApiKeyAuth: [], BearerAuth: [] }],
          summary: 'Revoke an active session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Session revoked' } },
        },
      },
      '/api/v1/db/{collection}': {
        get: {
          tags: ['Database'],
          summary: 'List / filter documents in a collection',
          parameters: [
            { name: 'collection', in: 'path', required: true, schema: { type: 'string', example: 'todos' } },
            { name: 'where', in: 'query', schema: { type: 'string', example: 'done==false' } },
            { name: 'orderBy', in: 'query', schema: { type: 'string', example: '_createdAt:desc' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { 200: { description: 'Paginated documents' } },
        },
        post: {
          tags: ['Database'],
          summary: 'Create a document (auto _id, _createdAt, _updatedAt)',
          parameters: [{ name: 'collection', in: 'path', required: true, schema: { type: 'string', example: 'todos' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', example: { title: 'Buy milk', done: false } } } },
          },
          responses: { 201: { description: 'Created document' } },
        },
      },
      '/api/v1/db/{collection}/query': {
        post: {
          tags: ['Database'],
          summary: 'Advanced structured JSON query',
          parameters: [{ name: 'collection', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Matching documents' } },
        },
      },
      '/api/v1/db/{collection}/batch': {
        post: {
          tags: ['Database'],
          summary: 'Atomic bulk create / update / replace / delete',
          parameters: [{ name: 'collection', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Per-op results' } },
        },
      },
      '/api/v1/db/{collection}/count': {
        get: {
          tags: ['Database'],
          summary: 'Count documents matching optional filter',
          parameters: [{ name: 'collection', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: '{ count }' } },
        },
      },
      '/api/v1/db/{collection}/{id}': {
        get: {
          tags: ['Database'],
          summary: 'Get document by ID',
          parameters: [
            { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Document' } },
        },
        patch: {
          tags: ['Database'],
          summary: 'Partial merge update',
          parameters: [
            { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Updated document' } },
        },
        put: {
          tags: ['Database'],
          summary: 'Replace document',
          parameters: [
            { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Replaced document' } },
        },
        delete: {
          tags: ['Database'],
          summary: 'Delete document',
          parameters: [
            { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Deleted' } },
        },
      },
      '/api/v1/storage/upload': {
        post: {
          tags: ['Storage'],
          summary: 'Upload file via multipart/form-data',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    folder: { type: 'string', example: 'avatars' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: '{ fileId, url, file }' } },
        },
      },
      '/api/v1/storage/list': {
        get: {
          tags: ['Storage'],
          summary: 'List stored files and folders',
          responses: { 200: { description: 'Files list' } },
        },
      },
      '/api/v1/storage/signed-url': {
        post: {
          tags: ['Storage'],
          summary: 'Generate presigned direct upload URL',
          responses: { 200: { description: 'Presigned PUT URL' } },
        },
      },
      '/api/v1/storage/{fileId}': {
        get: {
          tags: ['Storage'],
          summary: 'File metadata',
          parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'File metadata' } },
        },
        delete: {
          tags: ['Storage'],
          summary: 'Delete file',
          parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Deleted' } },
        },
      },
      '/api/v1/storage/{fileId}/download': {
        get: {
          tags: ['Storage'],
          summary: 'Get signed download URL (or download bytes with ?exp=&sig=)',
          parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Signed URL or binary stream' } },
        },
      },
      '/api/v1/admin/login': {
        post: {
          tags: ['Admin'],
          security: [],
          summary: 'Admin login -> admin Bearer JWT',
          responses: { 200: { description: '{ accessToken, user }' } },
        },
      },
      '/api/v1/admin/stats': {
        get: {
          tags: ['Admin'],
          security: [{ BearerAuth: [] }],
          summary: 'Dashboard metrics, 7-day request chart & recent activity',
          responses: { 200: { description: 'Dashboard stats' } },
        },
      },
    },
  };
}

export async function docsRoutes(app) {
  const distPath = swaggerUiDist.getAbsoluteFSPath();

  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/docs/assets/',
    decorateReply: false,
  });

  app.get('/openapi.json', async (req) => buildOpenApiSpec(originFromReq(req)));

  app.get('/docs', async (_req, reply) => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>BlueBeakend API Docs</title>
  <link rel="stylesheet" href="/docs/assets/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0b1120; }
    .topbar { background: linear-gradient(90deg,#0052cc,#0066ff) !important; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/assets/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
      });
    };
  </script>
</body>
</html>`;
    return reply.type('text/html; charset=utf-8').send(html);
  });
}
