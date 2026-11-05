// Production build: the site is plain ES modules, so the build copies src/ to dist/ unchanged.
// Every URL in src/index.html is relative (./app.js), so dist/ works at an IPFS gateway subpath.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(src)) cpSync(join(src, name), join(dist, name), { recursive: true });
console.log(`Copied ${readdirSync(dist).length} files from src/ to dist/: ${readdirSync(dist).join(', ')}`);
