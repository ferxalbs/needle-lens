export const X_HOST_ORIGINS = [
  'https://x.com/*',
  'https://www.x.com/*',
] as const;

export type XPermissionApi = {
  contains: (permissions: { origins: string[] }) => Promise<boolean>;
  request: (permissions: { origins: string[] }) => Promise<boolean>;
};

export type XAccessResult =
  | { ok: true; requested: boolean }
  | { ok: false; code: 'permission_required' | 'permission_denied' | 'permission_check_failed' };

/**
 * Checks exact X host access and, only when it is missing, requests it.
 * Call this directly from the user gesture that grants access.
 */
export async function ensureXAccess(
  permissions: XPermissionApi,
): Promise<XAccessResult> {
  let alreadyGranted: boolean;
  try {
    alreadyGranted = await permissions.contains({ origins: [...X_HOST_ORIGINS] });
  } catch {
    return { ok: false, code: 'permission_check_failed' };
  }

  if (alreadyGranted) return { ok: true, requested: false };

  try {
    const granted = await permissions.request({ origins: [...X_HOST_ORIGINS] });
    return granted
      ? { ok: true, requested: true }
      : { ok: false, code: 'permission_denied' };
  } catch {
    return { ok: false, code: 'permission_required' };
  }
}
