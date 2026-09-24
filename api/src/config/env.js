const inDocker = !!(
  process.env.DOCKER_CONTAINER === 'true'
  || process.env.KUBERNETES_SERVICE_HOST
  || process.env.CI === 'true' && process.env.IMAGE_NAME
);

const defaultMongoUri = inDocker ? 'mongodb://mongo:27017' : 'mongodb://127.0.0.1:27017';
const defaultMlUrl = inDocker ? 'http://ml:8000' : 'http://127.0.0.1:8000';

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var ${name}`);
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),

  mongoUri: required('MONGO_URI', defaultMongoUri),
  mongoDb: process.env.MONGO_DB ?? 'internships',

  mlUrl: process.env.ML_URL ?? defaultMlUrl,
  mlTimeoutMs: Number(process.env.ML_TIMEOUT_MS ?? 30000),

  // Change this in .env before you deploy. The default exists so `docker
  // compose up` works with zero configuration, not because it is safe.
  jwtSecret: required('JWT_SECRET', 'dev-only-change-me'),
  jwtTtlDays: Number(process.env.JWT_TTL_DAYS ?? 7),

  webOrigin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(','),
  adminKey: process.env.ADMIN_KEY ?? 'dev-admin-key',

  // Ingestion
  ingestCron: process.env.INGEST_CRON ?? '0 */6 * * *',
  ingestOnBoot: process.env.INGEST_ON_BOOT !== 'false',
  adzunaAppId: process.env.ADZUNA_APP_ID ?? '',
  adzunaAppKey: process.env.ADZUNA_APP_KEY ?? '',
  adzunaCountry: process.env.ADZUNA_COUNTRY ?? 'in',
  greenhouseBoards: (process.env.GREENHOUSE_BOARDS ?? '').split(',').filter(Boolean),
  leverBoards: (process.env.LEVER_BOARDS ?? '').split(',').filter(Boolean),

  isProd() { return this.nodeEnv === 'production'; },
};
