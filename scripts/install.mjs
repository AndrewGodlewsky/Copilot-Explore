import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = process.env.COPILOT_CLI_PATH || 'copilot';
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'inherit' });
  if (result.error) throw new Error(`Could not start Copilot. Put copilot on PATH or set COPILOT_CLI_PATH to the installed executable. ${result.error.code}`);
  if (result.status !== 0) throw new Error(`Command failed (exit ${result.status}). Installation stopped.`);
}
run(process.execPath, ['scripts/check.mjs']);
run(cli, ['plugin', 'marketplace', 'add', root]);
run(cli, ['plugin', 'install', 'explorer@copilot-explorer']);
run(cli, ['plugin', 'list', '--json']);
console.log('Start a new Copilot desktop session and use /explore. Keep this checkout: the local marketplace loads it live.');
