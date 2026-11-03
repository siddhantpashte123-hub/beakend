// ─────────────────────────────────────────────────────────────
// BlueBeakend — server entrypoint
// Supports ROLE=full (default), ROLE=realtime, and ROLE=minio
// (built-in S3-compatible object storage microservice).
// ─────────────────────────────────────────────────────────────
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

async function main() {
  if (config.role === 'minio' || config.role === 'storage') {
    const { startS3Server } = await import('./s3/server.js');
    const s3 = await startS3Server({
      port: config.port,
      host: config.host,
    });
    const shutdown = async (sig) => {
      log.info(`received ${sig}, closing S3 storage server…`);
      await s3.close();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    return;
  }

  const { buildApp } = await import('./app.js');
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });

  const { bootInfo } = app.bb;
  log.info(`BlueBeakend v${config.version} (${config.role}) listening on http://${config.host}:${config.port}`);
  if (bootInfo) {
    log.info(`Admin email : ${bootInfo.adminEmail}`);
    if (bootInfo.generatedAdminPassword) {
      log.warn(`Generated admin password: ${bootInfo.generatedAdminPassword}`);
    }
    log.info(`Default key : ${bootInfo.apiKey}`);
  }

  const shutdown = async (sig) => {
    log.info(`received ${sig}, shutting down cleanly…`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
