import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Needle Lens',
    description:
      'Turn the information already in front of you into a finished session.',
    permissions: ['activeTab', 'scripting', 'storage', 'sidePanel'],
    host_permissions: ['https://api.typesafe.ai/*'],
    action: {
      default_title: 'Open Needle Lens',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
  },
});
