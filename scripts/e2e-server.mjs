// Startet die Zentrale für die E2E-Tests mit einer frischen, separaten lokalen Datenbank
// (apps/worker/.wrangler/e2e) – die eigenen Entwicklungsdaten bleiben unberührt.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('../apps/worker/', import.meta.url));
const persist = '.wrangler/e2e';
const shell = process.platform === 'win32';

rmSync(new URL('../apps/worker/.wrangler/e2e', import.meta.url), { recursive: true, force: true });

const migration = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'te-zentrale-db', '--local', '--persist-to', persist], {
  cwd: worker,
  shell,
  stdio: 'inherit',
  env: { ...process.env, CI: '1' },
});
if (migration.status !== 0) process.exit(migration.status ?? 1);

const server = spawn(
  'npx',
  ['wrangler', 'dev', '--port', '8788', '--persist-to', persist, '--var', 'DEV_LOGIN:1', '--var', 'ERLAUBTE_ORIGINS:http://localhost:8788', '--show-interactive-dev-session=false'],
  { cwd: worker, shell, stdio: 'inherit', env: { ...process.env, CI: '1' } },
);
const ende = () => server.kill();
process.on('SIGINT', ende);
process.on('SIGTERM', ende);
server.on('exit', (code) => process.exit(code ?? 0));
