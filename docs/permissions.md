# Needle Lens permission rationale

The production manifest is intentionally narrow:

```json
{
  "permissions": ["activeTab", "scripting", "storage", "sidePanel"],
  "optional_host_permissions": ["https://x.com/*", "https://www.x.com/*"],
  "host_permissions": ["https://api.typesafe.ai/*"]
}
```

- `activeTab` remains required for the user-initiated extraction. The side panel explicitly requests the two exact optional X origins only after the user presses **Grant access to X**; it checks that access before reading the active tab URL. Needle Lens fails closed unless the active tab is an HTTPS `x.com` or `www.x.com` page.
- `scripting` is used by the service worker to run the bundled unlisted `visible.js` extractor in that active tab after the user presses **Preview visible posts**. No registered content script runs on page load.
- `storage` provides `chrome.storage.session`. The API key, decision signals, receipt, and cache are memory-only extension state. The service worker calls `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`, so content scripts cannot read the storage area.
- `sidePanel` supplies the user-controlled workflow where the browser exposes that API. The service worker capability-checks it; on Opera GX builds without `sidePanel`, it assigns the same `sidepanel.html` page to the toolbar action popup. That page is the only UI that can request extraction, provider evaluation, or outcome recording.
- `https://api.typesafe.ai/*` is the sole required host permission. It is needed for the service worker's direct HTTPS request to the verified TypeSafe AI endpoint. X access is optional and limited to the two exact X origins above; no proxy, analytics host, or wildcard origin is requested.

Needle Lens does not request `tabs`, `webRequest`, cookies, history, identity, downloads, `unlimitedStorage`, or `<all_urls>`. It does not use X APIs or automate navigation or write actions.
