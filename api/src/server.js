import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import cron from 'node-cron';

import { env } from './config/env.js';
import { connectMongo } from './db/mongo.js';
import { runIngest } from './ingest/index.js';
import { attachUser } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import { Opportunity } from './models/index.js';
import routes from './routes/index.js';
import { warmUp } from './services/mlClient.js';

const app = express();

app.set('trust proxy', 1); // Render and Vercel sit behind a proxy
app.use(morgan(env.isProd() ? 'combined' : 'dev'));

// Credentials must be allowed for the auth cookie to survive the round trip.
// If you see "cookie set but never sent back", this and SameSite are the two
// places to look -- in that order.
app.use(cors({ origin: env.webOrigin, credentials: true }));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

async function start() {
  await connectMongo();

  // Mongoose only creates indexes when it first sees the model. Forcing it at
  // boot means a missing index fails loudly here rather than showing up as a
  // mysteriously slow feed on day six.
  await Opportunity.syncIndexes().catch((err) =>
    console.warn('[mongo] index sync:', err.message));

  const server = app.listen(env.port, () => {
    console.log(`[api] listening on :${env.port} (${env.nodeEnv})`);
  });

  // Do not await: a cold ML container can take a minute, and the API should be
  // answering requests during that time.
  warmUp();

  if (env.ingestOnBoot) {
    (async () => {
      const count = await Opportunity.estimatedDocumentCount();
      if (count === 0) {
        console.log('[ingest] empty database - running first pass');
        await runIngest().catch((err) => console.error('[ingest] boot run failed:', err.message));
      } else {
        console.log(`[ingest] ${count} listings already present - skipping boot run`);
      }
    })();
  }

  if (cron.validate(env.ingestCron)) {
    cron.schedule(env.ingestCron, () => {
      console.log('[ingest] scheduled run starting');
      runIngest().catch((err) => console.error('[ingest] scheduled run failed:', err.message));
    });
    console.log(`[ingest] scheduled "${env.ingestCron}"`);
  }

  const shutdown = (signal) => {
    console.log(`[api] ${signal} - shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});

export default app;
