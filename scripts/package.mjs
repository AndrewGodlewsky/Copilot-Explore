import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
if (check.status !== 0) process.exit(check.status || 1);
const { version } = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
const destination = join(root, 'dist', `explorer-${version}-${Date.now()}`);
await mkdir(destination, { recursive: true });
for (const name of ['plugin.json', '.github', 'skills', 'assets', 'com.github.copilot', 'release-notes.json', 'README.md']) await cp(join(root, name), join(destination, name), { recursive: true, errorOnExist: true, force: false });
console.log(`Installable plugin directory: ${destination}`);
