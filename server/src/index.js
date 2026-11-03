// ─────────────────────────────────────────────────────────────
// BlueBeakend — server entrypoint
// ─────────────────────────────────────────────────────────────
import { buildApp } from './app.js';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

async function main() {
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
