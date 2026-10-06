import { backup, DatabaseSync } from 'node:sqlite';
import { chmod, link, lstat, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

process.umask(0o077);

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Il file esiste già: ${path}. Conservare l'intero database precedente offline; nessuna sovrascrittura automatica.`);
}

function validate(database: DatabaseSync): void {
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== 'ok') {
    throw new Error('Il database sorgente non supera integrity_check.');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length) {
    throw new Error('Il database sorgente contiene riferimenti incoerenti.');
  }
  const tables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((row) => row.name));
  for (const name of ['schema_migrations', 'metadata', 'tenants', 'users', 'programs', 'members', 'transactions', 'idempotency', 'jobs']) {
    if (!tables.has(name)) throw new Error(`Il backup non contiene lo schema Fidelity Studio atteso: ${name}.`);
  }
  // Keep this guard aligned with migrations; refuse future schemas instead of guessing.
  const version = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version;
  if (version !== 1 && version !== 2 && version !== 3) throw new Error('Versione schema non supportata da questa versione dello script (attese: 1, 2 o 3).');
  if (version >= 2) {
    for (const name of ['automations', 'automation_runs']) {
      if (!tables.has(name)) throw new Error(`Il backup non contiene lo schema v2 atteso: ${name}.`);
    }
    const memberColumns = new Set(database.prepare('PRAGMA table_info(members)').all().map((row) => row.name));
    for (const name of ['google_issued', 'apple_issued']) {
      if (!memberColumns.has(name)) throw new Error(`Il backup non contiene la colonna v2 attesa: members.${name}.`);
    }
  }
  if (version >= 3) {
    if (!tables.has('branding')) throw new Error('Il backup non contiene lo schema v3 atteso: branding.');
    const tenantColumns = new Set(database.prepare('PRAGMA table_info(tenants)').all().map((row) => row.name));
    for (const name of ['privacy_url', 'terms_text']) {
      if (!tenantColumns.has(name)) throw new Error(`Il backup non contiene la colonna v3 attesa: tenants.${name}.`);
    }
  }
}

async function main(): Promise<void> {
  try { process.loadEnvFile('.env'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--offline' || args[1]!.startsWith('--')) {
    throw new Error('Arrestare tutti i processi applicativi, poi: node scripts/restore.ts --offline backup.sqlite (destinazione: DATABASE_PATH, deve essere assente).');
  }
  const source = resolve(args[1]!);
  const destination = resolve(process.env.DATABASE_PATH || 'data/fidelity.sqlite');
  if (source === destination) throw new Error('Origine e destinazione devono essere differenti.');
  if (!(await lstat(source)).isFile()) throw new Error('Il backup deve essere un file regolare, non un collegamento.');
  // Only a standalone snapshot may be restored. Never silently omit a source WAL.
  for (const suffix of ['-wal', '-shm', '-journal']) await assertAbsent(`${source}${suffix}`);
  for (const suffix of ['', '-wal', '-shm', '-journal']) await assertAbsent(`${destination}${suffix}`);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(dirname(destination), '.fidelity-restore-'));
  const stagedFile = join(staging, basename(destination));
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
    validate(database);
    await backup(database, stagedFile);
    const restored = new DatabaseSync(stagedFile);
    try {
      restored.exec('PRAGMA journal_mode=DELETE');
      validate(restored);
    } finally {
      restored.close();
    }
    await chmod(stagedFile, 0o600);
    const file = await open(stagedFile, 'r');
    try { await file.sync(); } finally { await file.close(); }
    for (const suffix of ['-wal', '-shm', '-journal']) await assertAbsent(`${destination}${suffix}`);
    await link(stagedFile, destination);
    console.log(`Ripristino verificato: ${destination}. Riavviare una sola istanza applicativa e verificare i saldi prima di riaprire il servizio.`);
  } finally {
    database?.close();
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`Ripristino non completato: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
