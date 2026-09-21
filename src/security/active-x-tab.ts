import { X_HOST_ORIGINS } from './x-access';

export type ActiveTabErrorCode =
  | 'permission_required'
  | 'permission_check_failed'
  | 'permission_denied'
  | 'active_tab_unavailable'
  | 'tab_url_unavailable'
  | 'unsupported_page'
  | 'injection_failed'
  | 'active_tab_changed';

export type ActiveXTab = {
  id: number;
  url: string;
  tab: Browser.tabs.Tab;
};

export type ActiveXTabResult =
  | { ok: true; value: ActiveXTab }
  | { ok: false; code: ActiveTabErrorCode };

type ActiveTabApi = {
  query: (queryInfo: {
    active: boolean;
    currentWindow: boolean;
  }) => Promise<Browser.tabs.Tab[]>;
};

type PermissionApi = {
  contains: (permissions: { origins: string[] }) => Promise<boolean>;
};

export function parseEligibleXUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'x.com' && url.hostname !== 'www.x.com')
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

/**
 * Canonical active-tab lookup. Host access is checked before reading tab.url
 * because browsers may omit it when the optional origin is not granted.
 */
export async function getActiveXTab(
  tabs: ActiveTabApi,
  permissions: PermissionApi,
): Promise<ActiveXTabResult> {
  try {
    if (!(await permissions.contains({ origins: [...X_HOST_ORIGINS] }))) {
      return { ok: false, code: 'permission_required' };
    }
  } catch {
    return { ok: false, code: 'permission_check_failed' };
  }

  let matches: Browser.tabs.Tab[];
  try {
    matches = await tabs.query({ active: true, currentWindow: true });
  } catch {
    return { ok: false, code: 'active_tab_unavailable' };
  }

  const tab = matches[0];
  if (
    !tab ||
    typeof tab.id !== "number" ||
    !Number.isInteger(tab.id) ||
    tab.id < 0
  ) {
    return { ok: false, code: 'active_tab_unavailable' };
  }
  if (typeof tab.url !== "string" || tab.url.length === 0) {
    return { ok: false, code: 'tab_url_unavailable' };
  }

  const url = parseEligibleXUrl(tab.url);
  if (!url) return { ok: false, code: 'unsupported_page' };
  return { ok: true, value: { id: tab.id, url: url.href, tab } };
}
