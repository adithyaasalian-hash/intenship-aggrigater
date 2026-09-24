import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { env } from '../config/env.js';

let memoryServer;

export async function connectMongo() {
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(env.mongoUri, {
      dbName: env.mongoDb,
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[mongo] connected to ${env.mongoDb}`);
    return mongoose.connection;
  } catch (err) {
    if (env.nodeEnv === 'production') throw err;

    console.warn(`[mongo] ${env.mongoUri} unavailable, starting embedded MongoDB for local development`);
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(), {
      dbName: env.mongoDb,
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[mongo] connected to embedded MongoDB (${env.mongoDb})`);
    return mongoose.connection;
  }
}

export async function disconnectMongo() {
  if (memoryServer) {
    await mongoose.disconnect();
    await memoryServer.stop();
    memoryServer = undefined;
    return;
  }

  await mongoose.disconnect();
}
