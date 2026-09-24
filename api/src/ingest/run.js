/**
 * Standalone ingestion entrypoint.
 *
 *   npm run ingest            # every enabled source
 *   npm run ingest:seed       # just the committed seed rows
 *   node src/ingest/run.js remoteok remotive
 */
import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { runIngest } from './index.js';

const only = process.argv.slice(2).filter(Boolean);

await connectMongo();
const summary = await runIngest({ only: only.length ? only : undefined });
console.table(summary.runs);
console.log(`\ntotal active listings: ${summary.totalActive}`);
await disconnectMongo();
process.exit(summary.runs.some((r) => r.errors.length) ? 1 : 0);
