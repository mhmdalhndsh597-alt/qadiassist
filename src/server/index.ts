import 'dotenv/config';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import app from './app.js';
import { pool } from './db/index.js';
import { runMigrations } from './db/migrate.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error('PORT must be an integer from 1024 to 65535.');
}

// Migrations use only additive, idempotent CREATE TABLE statements and are serialized by MySQL lock.
await runMigrations();

if (process.env.NODE_ENV === 'production') {
  const clientDirectory = path.resolve(currentDirectory, '../../dist/client');
  const indexFile = path.join(clientDirectory, 'index.html');
  app.use(express.static(clientDirectory, { index: false, fallthrough: true }));
  app.get(/^(?!\/api(?:\/|$)|\/healthz(?:\/|$)).*/, (_req, res) => res.sendFile(indexFile));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const server = createServer(app);
server.listen(port, '0.0.0.0', () => process.stdout.write(`مِعيار يعمل على المنفذ ${port}\n`));

const shutdown = () => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
