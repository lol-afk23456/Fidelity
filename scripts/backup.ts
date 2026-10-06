import { backup, DatabaseSync } from 'node:sqlite';
import { chmod, link, lstat, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Keep databases, session tokens and personal data private on creation.
process.umask(0o077);

async function main(): Promise<void> {
  try { process.loadEnvFile('.env'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg.startsWith('--'))) {
    throw new Error('Uso: node scripts/backup.ts [destinazione.sqlite] (origine: DATABASE_PATH).');
  }
  const source = resolve(process.env.DATABASE_PATH || 'data/fidelity.sqlite');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = resolve(args[0] || join(dirname(source), 'backups', `fidelity-${stamp}-${randomUUID().slice(0, 8)}.sqlite`));
  if (source === destination) throw new Error('Origine e destinazione devono essere differenti.');
  if (!(await lstat(source)).isFile()) throw new Error('Il database deve essere un file regolare, non un collegamento.');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(dirname(destination), '.fidelity-backup-'));
  const stagedFile = join(staging, basename(destination));
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
    // SQLite's online backup includes committed WAL records. A plain file copy does not.
    await backup(database, stagedFile);
    const snapshot = new DatabaseSync(stagedFile);
    try {
      snapshot.exec('PRAGMA journal_mode=DELETE');
      const rows = snapshot.prepare('PRAGMA integrity_check').all();
      if (rows.length !== 1 || Object.values(rows[0]!)[0] !== 'ok') {
        throw new Error('Il controllo di integrità del backup non è riuscito.');
      }
      if (snapshot.prepare('PRAGMA foreign_key_check').all().length !== 0) {
        throw new Error('Il backup contiene riferimenti incoerenti.');
      }
    } finally {
      snapshot.close();
    }
    await chmod(stagedFile, 0o600);
    const file = await open(stagedFile, 'r');
    try { await file.sync(); } finally { await file.close(); }
    // An atomic hard link never overwrites an existing destination, even in a race.
    await link(stagedFile, destination);
    console.log(`Backup verificato: ${destination}`);
  } finally {
    database?.close();
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`Backup non completato: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
