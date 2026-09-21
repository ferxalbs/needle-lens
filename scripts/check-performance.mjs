import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const outputDir = '.output/chrome-mv3';
const sidepanelDir = join(outputDir, 'chunks');
const sidepanelFiles = (await readdir(sidepanelDir)).filter((name) => /^sidepanel-.*\.js$/.test(name));
if (sidepanelFiles.length !== 1) {
  throw new Error(`Expected exactly one side-panel chunk, found ${sidepanelFiles.length}.`);
}

const sidepanelBytes = (await readFile(join(sidepanelDir, sidepanelFiles[0])));
const sidepanelGzipBytes = gzipSync(sidepanelBytes, { level: 9 }).byteLength;
const contentBytes = await readFile(join(outputDir, 'visible.js'));
const contentGzipBytes = gzipSync(contentBytes, { level: 9 }).byteLength;

let packagedBytes = 0;
const packagedFiles = [];
async function addFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'icon') await addFiles(path);
      continue;
    }
    packagedFiles.push(path);
    if (!path.endsWith('.map')) packagedBytes += (await stat(path)).size;
  }
}
await addFiles(outputDir);

const sourceMaps = packagedFiles.filter((path) => path.endsWith('.map'));
if (sourceMaps.length > 0) {
  throw new Error(`Production output contains source maps: ${sourceMaps.join(', ')}`);
}
const loggingFiles = [];
for (const path of packagedFiles.filter((value) => /\.(?:js|html)$/.test(value))) {
  const source = await readFile(path, 'utf8');
  if (/\bconsole\.log\s*\(/.test(source)) loggingFiles.push(path);
}
if (loggingFiles.length > 0) {
  throw new Error(`Production output contains development logging: ${loggingFiles.join(', ')}`);
}

const limits = {
  sidepanelGzipBytes: 150_000,
  contentGzipBytes: 100_000,
  packagedBytes: 500_000,
};
if (sidepanelGzipBytes > limits.sidepanelGzipBytes) {
  throw new Error(`Side-panel gzip budget exceeded: ${sidepanelGzipBytes} > ${limits.sidepanelGzipBytes}.`);
}
if (contentGzipBytes > limits.contentGzipBytes) {
  throw new Error(`Content-script gzip budget exceeded: ${contentGzipBytes} > ${limits.contentGzipBytes}.`);
}
if (packagedBytes > limits.packagedBytes) {
  throw new Error(`Packaged extension budget exceeded: ${packagedBytes} > ${limits.packagedBytes}.`);
}

console.log(`performance ok: sidepanel=${sidepanelGzipBytes}B gzip, content=${contentGzipBytes}B gzip, package=${packagedBytes}B`);
