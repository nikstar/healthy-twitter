import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const name of readdirSync(new URL('../extension/', import.meta.url))) {
  if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', new URL(`../extension/${name}`, import.meta.url).pathname], { stdio: 'inherit' });
}
