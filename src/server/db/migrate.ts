import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);
const migrationTable = '_meyar_migrations';

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations.');

  const connection = await createConnection(databaseUrl);
  let lockHeld = false;
  try {
    interface LockRow extends RowDataPacket {
      acquired: number | null;
    }
    interface MigrationRow extends RowDataPacket {
      name: string;
    }
    const [lockRows] = await connection.query<LockRow[]>('SELECT GET_LOCK(?, 15) AS acquired', [
      'meyar-case-workspace-migrations',
    ]);
    lockHeld = lockRows[0]?.acquired === 1;
    if (!lockHeld) throw new Error('Could not acquire the migration lock.');

    await connection.query(`CREATE TABLE IF NOT EXISTS ${migrationTable} (
      name varchar(191) NOT NULL PRIMARY KEY,
      applied_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const [appliedRows] = await connection.query<MigrationRow[]>(
      `SELECT name FROM ${migrationTable}`,
    );
    const applied = new Set(appliedRows.map((row) => row.name));
    const files = (await fs.readdir(migrationDirectory))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const contents = (await fs.readFile(path.join(migrationDirectory, file), 'utf8'))
        .replace(/^\s*--.*$/gm, '')
        .trim();
      const statements = contents
        .split(/;\s*(?:\r?\n|$)/)
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) await connection.query(statement);
      await connection.query(`INSERT INTO ${migrationTable} (name) VALUES (?)`, [file]);
      process.stdout.write(`Applied ${file}\n`);
    }
    process.stdout.write('Database migrations are up to date.\n');
  } finally {
    if (lockHeld)
      await connection
        .query('SELECT RELEASE_LOCK(?)', ['meyar-case-workspace-migrations'])
        .catch(() => undefined);
    await connection.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Migration failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
