import assert from 'node:assert/strict';
import test from 'node:test';

const originalMongo = process.env.MONGO_URI;
const originalMl = process.env.ML_URL;

test('defaults to localhost services when not running in Docker', async () => {
  delete process.env.MONGO_URI;
  delete process.env.ML_URL;

  try {
    const { env } = await import('../src/config/env.js');
    assert.equal(env.mongoUri, 'mongodb://127.0.0.1:27017');
    assert.equal(env.mlUrl, 'http://127.0.0.1:8000');
  } finally {
    if (originalMongo === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = originalMongo;

    if (originalMl === undefined) delete process.env.ML_URL;
    else process.env.ML_URL = originalMl;
  }
});
