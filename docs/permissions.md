# Needle Lens permission rationale

The production manifest is intentionally narrow:

```json
{
  "permissions": ["activeTab", "scripting", "storage", "sidePanel"],
  "host_permissions": ["https://api.typesafe.ai/*"]
}
```

- `activeTab` grants temporary access to the tab the user explicitly acts on. Needle Lens fails closed unless the active tab is an HTTPS `x.com` or `www.x.com` page. It does not request a permanent X host permission.
- `scripting` is used by the service worker to run the bundled unlisted `visible.js` extractor in that active tab after the user presses **Preview visible posts**. No registered content script runs on page load.
- `storage` provides `chrome.storage.session`. The API key, decision signals, receipt, and cache are memory-only extension state. The service worker calls `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`, so content scripts cannot read the storage area.
- `sidePanel` supplies the user-controlled workflow where the browser exposes that API. The service worker capability-checks it; on Opera GX builds without `sidePanel`, it assigns the same `sidepanel.html` page to the toolbar action popup. That page is the only UI that can request extraction, provider evaluation, or outcome recording.
- `https://api.typesafe.ai/*` is the sole host permission. It is needed for the service worker's direct HTTPS request to the verified TypeSafe AI endpoint. No X host permission, proxy, analytics host, or wildcard origin is requested.

Needle Lens does not request `tabs`, `webRequest`, cookies, history, identity, downloads, `unlimitedStorage`, or `<all_urls>`. It does not use X APIs or automate navigation or write actions.
