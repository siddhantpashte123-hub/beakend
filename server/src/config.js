// ─────────────────────────────────────────────────────────────
// BlueBeakend — configuration (env-driven, with safe defaults)
// ─────────────────────────────────────────────────────────────
import 'dotenv/config';

const bool = (v, dflt) =>
  v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const int = (v, dflt) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? dflt : Number(v));

export const config = {
  env: process.env.NODE_ENV || 'production',
  role: (process.env.ROLE || 'full').toLowerCase(), // full | realtime
  version: process.env.BB_VERSION || '1.0.0',
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',

  domain: process.env.BB_DOMAIN || 'localhost',
  protocol: process.env.BB_PROTOCOL || 'http',

  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',

  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtIssuer: process.env.JWT_ISSUER || 'bluebeakend',
  accessTtl: int(process.env.ACCESS_TOKEN_TTL, 900),
  refreshTtl: int(process.env.REFRESH_TOKEN_TTL, 2592000),

  adminEmail: process.env.ADMIN_EMAIL || 'admin@bluebeakend.local',
  adminPassword: process.env.ADMIN_PASSWORD || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'BlueBeakend <no-reply@bluebeakend.local>',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    accessKey: process.env.S3_ACCESS_KEY || process.env.MINIO_ROOT_USER || '',
    secretKey: process.env.S3_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '',
    bucket: process.env.S3_BUCKET || process.env.MINIO_BUCKET || 'bluebeakend',
    region: process.env.S3_REGION || 'us-east-1',
  },

  storageDir: process.env.STORAGE_DIR || new URL('../storage-data', import.meta.url).pathname,
  backupsDir: process.env.BACKUPS_DIR || new URL('../backups', import.meta.url).pathname,

  rateLimitRpm: int(process.env.RATE_LIMIT_RPM, 600),
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 50),
  enableSignups: bool(process.env.ENABLE_SIGNUPS, true),
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),

  publicUrl() {
    return `${this.protocol}://${this.domain}`;
  },
};

export default config;
