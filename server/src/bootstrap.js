// ─────────────────────────────────────────────────────────────
// BlueBeakend — startup bootstrap
// Ensures the first super-admin user + default project API key
// exist on first boot. Optionally seeds sample data in demo mode.
// ─────────────────────────────────────────────────────────────
import { config } from './config.js';
import { hashPassword, generatePassword } from './utils/passwords.js';
import { newApiKey, uuid } from './utils/ids.js';
import { createLogger } from './logger.js';

const log = createLogger('bootstrap');

export async function bootstrap({ db, cache, storage }) {
  let admin = await db.findUserByEmail(config.adminEmail);
  let generatedAdminPassword = null;

  if (!admin) {
    const password = config.adminPassword || generatePassword();
    if (!config.adminPassword) generatedAdminPassword = password;
    admin = await db.createUser({
      email: config.adminEmail,
      passwordHash: await hashPassword(password),
      name: 'Super Admin',
      role: 'admin',
      emailVerified: true,
    });
    await db.recordActivity({
      type: 'system.bootstrap',
      actor: 'system',
      userId: admin.id,
      message: `Initialized super-admin ${admin.email}`,
    });
    log.info(`bootstrapped super-admin: ${admin.email}`);
  } else if (admin.role !== 'admin') {
    admin = await db.updateUser(admin.id, { role: 'admin' });
  }

  let keys = await db.listApiKeys();
  let defaultKey = keys.find((k) => k.status === 'active') || null;
  if (!defaultKey) {
    const rawKey =
      process.env.API_KEY && /^bb_(live|test)_[0-9a-f]{40}$/.test(process.env.API_KEY)
        ? process.env.API_KEY
        : newApiKey(true);
    defaultKey = await db.createApiKey({
      key: rawKey,
      name: process.env.DEFAULT_PROJECT_NAME || 'default-project',
      live: true,
      createdBy: admin.id,
    });
    await db.recordActivity({
      type: 'system.apikey',
      actor: 'system',
      message: `Provisioned default API key (${defaultKey.name})`,
    });
    log.info(`provisioned default API key: ${defaultKey.name}`);
  }

  // Optional demo data seed (for preview / sandbox showcase)
  if (process.env.SEED_DEMO === 'true' && (await db.totalDocs()) === 0) {
    await seedDemoData({ db, cache, storage, admin });
  }

  return {
    adminEmail: admin.email,
    generatedAdminPassword,
    apiKey: defaultKey.key,
  };
}

async function seedDemoData({ db, cache, storage, admin }) {
  // Sample users
  const demoUsers = [
    { email: 'aarav.sharma@acme.dev', name: 'Aarav Sharma', provider: 'password', emailVerified: true, metadata: { plan: 'pro', app: 'flutter-shop' } },
    { email: 'maya.patel@nimbus.io', name: 'Maya Patel', provider: 'google', emailVerified: true, metadata: { plan: 'team', region: 'ap-south-1' } },
    { email: 'liam.chen@orbit.app', name: 'Liam Chen', provider: 'github', emailVerified: true, metadata: { plan: 'starter' } },
    { email: 'sofia.rossi@studio.it', name: 'Sofia Rossi', provider: 'password', emailVerified: false, metadata: { plan: 'free' } },
  ];
  for (const u of demoUsers) {
    const created = await db.createUser({
      ...u,
      passwordHash: await hashPassword('DemoPass123!'),
    });
    await db.updateUser(created.id, { lastLoginAt: new Date(Date.now() - Math.random() * 86400_000 * 3).toISOString() });
  }

  // Second API key for mobile app
  await db.createApiKey({
    key: newApiKey(true),
    name: 'flutter-mobile-app',
    live: true,
    createdBy: admin.id,
  });

  // Sample collections & documents
  const todos = [
    { title: 'Deploy BlueBeakend on Hetzner VPS', done: true, priority: 1, assignee: 'aarav@acme.dev', tags: ['ops', 'vps'] },
    { title: 'Connect Flutter SDK with realtime listener', done: true, priority: 1, assignee: 'maya@nimbus.io', tags: ['flutter', 'realtime'] },
    { title: 'Configure custom domain SSL via bb menu', done: false, priority: 2, assignee: 'liam@orbit.app', tags: ['ssl', 'nginx'] },
    { title: 'Schedule automated nightly backups', done: false, priority: 2, assignee: 'aarav@acme.dev', tags: ['backup'] },
    { title: 'Set SMTP credentials for password resets', done: false, priority: 3, assignee: 'sofia@studio.it', tags: ['smtp'] },
  ];
  for (const t of todos) await db.insertDoc('todos', t);

  const products = [
    { name: 'Pro Cloud Plan', price: 29, currency: 'USD', inStock: true, category: 'subscriptions' },
    { name: 'Realtime Add-on', price: 9, currency: 'USD', inStock: true, category: 'addons' },
    { name: 'Dedicated Backup Vault', price: 15, currency: 'USD', inStock: true, category: 'storage' },
    { name: 'Enterprise Support', price: 99, currency: 'USD', inStock: true, category: 'support' },
  ];
  for (const p of products) await db.insertDoc('products', p);

  const messages = [
    { room: 'general', sender: 'Maya Patel', text: 'Realtime sync latency is <12ms on our VPS!', likes: 8 },
    { room: 'general', sender: 'Aarav Sharma', text: 'Zero Firebase bills this month.', likes: 14 },
    { room: 'releases', sender: 'Liam Chen', text: 'Shipped v1.0.0 mobile build against BlueBeakend.', likes: 6 },
  ];
  for (const m of messages) await db.insertDoc('messages', m);

  await db.ensureCollection('audit_logs');
  await db.insertDoc('audit_logs', { action: 'cluster.init', actor: admin.email, region: 'ap-south-1', ok: true });

  // Sample SVG banner & JSON config file in storage
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260" viewBox="0 0 480 260">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0066FF"/><stop offset="100%" stop-color="#00C2FF"/></linearGradient></defs>
  <rect width="480" height="260" rx="20" fill="url(#g)"/>
  <circle cx="88" cy="130" r="42" fill="rgba(255,255,255,0.18)"/>
  <text x="152" y="122" fill="#fff" font-family="system-ui,sans-serif" font-size="30" font-weight="700">BlueBeakend</text>
  <text x="152" y="156" fill="rgba(255,255,255,0.88)" font-family="system-ui,sans-serif" font-size="15">Self-Hosted Firebase Alternative</text>
</svg>`;
  const svgId = uuid();
  await storage.put(`${admin.id}/branding/${svgId}`, Buffer.from(svg), { mime: 'image/svg+xml' });
  await db.createFile({
    id: svgId,
    userId: admin.id,
    storageKey: `${admin.id}/branding/${svgId}`,
    name: 'bluebeakend-banner.svg',
    folder: 'branding',
    mime: 'image/svg+xml',
    size: Buffer.byteLength(svg),
    isPublic: true,
  });

  const readmeBuf = Buffer.from(JSON.stringify({ project: 'my-flutter-app', env: 'production', sdkVersion: '1.0.0' }, null, 2));
  const jsonId = uuid();
  await storage.put(`${admin.id}/configs/${jsonId}`, readmeBuf, { mime: 'application/json' });
  await db.createFile({
    id: jsonId,
    userId: admin.id,
    storageKey: `${admin.id}/configs/${jsonId}`,
    name: 'app-config.json',
    folder: 'configs',
    mime: 'application/json',
    size: readmeBuf.length,
    isPublic: false,
  });

  // Seed realistic 7-day request history
  const sampleCounts = [412, 685, 829, 764, 1120, 1390, 248];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    await cache.set(`req:day:${day}`, sampleCounts[6 - i], 86400 * 14);
  }

  await db.recordActivity({ type: 'db.created', actor: 'aarav.sharma@acme.dev', message: 'Created 5 documents in "todos"' });
  await db.recordActivity({ type: 'storage.uploaded', actor: admin.email, message: 'Uploaded "bluebeakend-banner.svg" to /branding' });
  await db.recordActivity({ type: 'auth.register', actor: 'maya.patel@nimbus.io', message: 'New user registered: maya.patel@nimbus.io' });
  log.info('seeded demo dataset');
}
