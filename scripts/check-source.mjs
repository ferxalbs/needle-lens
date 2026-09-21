import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['entrypoints', 'src', 'tests'];
const extensions = new Set(['.ts', '.tsx', '.mjs', '.css', '.html', '.json']);
const alternateRuntimePattern = new RegExp('pre' + 'act', 'i');
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (extensions.has(path.slice(path.lastIndexOf('.')))) files.push(path);
  }
}

for (const root of roots) await collect(root);

const violations = [];
for (const path of files) {
  const source = await readFile(path, 'utf8');
  if (alternateRuntimePattern.test(source)) violations.push(`${path}: alternate UI runtime reference`);
  if (/\bconsole\.log\s*\(/.test(source)) violations.push(`${path}: development console.log`);
  if (/unsafe-(?:eval|inline)/i.test(source)) violations.push(`${path}: unsafe CSP token`);
  if (/^(?:entrypoints|src)\//.test(path) && /Authorization\s*[:=]\s*["'`]Bearer\s+(?:ts|jev)_[A-Za-z0-9_-]+/i.test(source)) {
    violations.push(`${path}: bearer key literal`);
  }
}

if (violations.length > 0) {
  throw new Error(`Source policy failed:\n${violations.join('\n')}`);
}
console.log(`source policy ok: ${files.length} files`);
