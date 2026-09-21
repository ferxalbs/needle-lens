import { readFile } from 'node:fs/promises';

const manifestPath = '.output/chrome-mv3/manifest.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const permissions = new Set(manifest.permissions ?? []);
const expected = new Set(['activeTab', 'scripting', 'storage', 'sidePanel']);

if (permissions.size !== expected.size || [...expected].some((permission) => !permissions.has(permission))) {
  throw new Error(`Unexpected permissions: ${JSON.stringify(manifest.permissions)}`);
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://api.typesafe.ai/*'])) {
  throw new Error(`Unexpected host permissions: ${JSON.stringify(manifest.host_permissions)}`);
}
for (const forbidden of ['<all_urls>', 'tabs', 'webRequest', 'unlimitedStorage', 'downloads']) {
  if (permissions.has(forbidden) || (manifest.host_permissions ?? []).includes(forbidden)) {
    throw new Error(`Forbidden broad permission present: ${forbidden}`);
  }
}
if (manifest.side_panel?.default_path !== 'sidepanel.html') throw new Error('Side panel path is missing.');
const csp = manifest.content_security_policy?.extension_pages ?? '';
if (!csp.includes("script-src 'self'") || csp.includes('unsafe-eval') || csp.includes('unsafe-inline')) {
  throw new Error(`Unexpected extension CSP: ${csp}`);
}
console.log(`manifest ok: ${manifest.name}, permissions=${[...permissions].join(',')}`);
