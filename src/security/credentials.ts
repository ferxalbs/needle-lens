import { sha256Hex } from './hash';

export const SESSION_API_KEY = 'needleLensSessionApiKey';
export const SESSION_KEY_FINGERPRINT = 'needleLensSessionKeyFingerprint';
export const SESSION_CREDENTIAL_RETENTION = 'needleLensSessionCredentialRetention';
export const LOCAL_CREDENTIAL_ENVELOPE = 'needleLensCredentialEnvelope';
export const LOCAL_CREDENTIAL_KEY = 'needleLensCredentialEncryptionKey';
export const LOCAL_KEY_FINGERPRINT = 'needleLensCredentialFingerprint';
export const CREDENTIAL_VERSION = 1 as const;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type CredentialRetention = 'session' | 'seven_days';

export type StorageAreaLike = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

export type CredentialEnvelope = {
  version: 1;
  algorithm: 'AES-GCM';
  iv: string;
  ciphertext: string;
  createdAt: number;
  expiresAt: number;
};

export type CredentialStatus = {
  configured: boolean;
  retention?: CredentialRetention;
  expiresAt?: number;
  fingerprint?: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) throw new Error('Credential envelope encoding is invalid.');
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseCredentialEnvelope(value: unknown): CredentialEnvelope | undefined {
  if (!isRecord(value) || value.version !== CREDENTIAL_VERSION || value.algorithm !== 'AES-GCM') return undefined;
  if (
    typeof value.iv !== 'string' || typeof value.ciphertext !== 'string' ||
    typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) ||
    typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt !== SEVEN_DAYS_MS
  ) return undefined;
  try {
    const iv = base64ToBytes(value.iv);
    const ciphertext = base64ToBytes(value.ciphertext);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16) return undefined;
  } catch {
    return undefined;
  }
  return {
    version: 1,
    algorithm: 'AES-GCM',
    iv: value.iv,
    ciphertext: value.ciphertext,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  };
}

function isNonExtractableAesKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== 'undefined' && value instanceof CryptoKey && value.type === 'secret' &&
    value.extractable === false && value.algorithm.name === 'AES-GCM';
}

export class CredentialStore {
  private readonly crypto: Crypto;
  private readonly now: () => number;

  constructor(
    private readonly session: StorageAreaLike,
    private readonly local: StorageAreaLike,
    options: { crypto?: Crypto; now?: () => number } = {},
  ) {
    this.crypto = options.crypto ?? globalThis.crypto;
    this.now = options.now ?? Date.now;
  }

  async purgeExpired(): Promise<void> {
    const values = await this.local.get([LOCAL_CREDENTIAL_ENVELOPE, LOCAL_CREDENTIAL_KEY, LOCAL_KEY_FINGERPRINT]);
    const envelope = parseCredentialEnvelope(values[LOCAL_CREDENTIAL_ENVELOPE]);
    if (!envelope || envelope.expiresAt <= this.now() || !isNonExtractableAesKey(values[LOCAL_CREDENTIAL_KEY])) {
      if (values[LOCAL_CREDENTIAL_ENVELOPE] !== undefined || values[LOCAL_CREDENTIAL_KEY] !== undefined || values[LOCAL_KEY_FINGERPRINT] !== undefined) {
        await this.removeRemembered();
      }
    }
  }

  async save(apiKey: string, retention: CredentialRetention): Promise<{ retention: CredentialRetention; fingerprint: string; expiresAt?: number; fallback: boolean }> {
    const normalized = apiKey.trim();
    if (normalized.length < 8 || /[\r\n]/.test(normalized)) throw new Error('The API key format was invalid.');
    await this.forget();
    const fingerprint = (await sha256Hex(normalized)).slice(0, 12);
    if (retention === 'session') {
      await this.session.set({
        [SESSION_API_KEY]: normalized,
        [SESSION_KEY_FINGERPRINT]: fingerprint,
        [SESSION_CREDENTIAL_RETENTION]: 'session',
      });
      return { retention: 'session', fingerprint, fallback: false };
    }

    const createdAt = this.now();
    const expiresAt = createdAt + SEVEN_DAYS_MS;
    try {
      const key = await this.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      if (!isNonExtractableAesKey(key)) throw new Error('The browser did not create a non-extractable encryption key.');
      const iv = this.crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode(normalized) as unknown as BufferSource;
      const ciphertext = await this.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, plaintext);
      const envelope: CredentialEnvelope = {
        version: 1,
        algorithm: 'AES-GCM',
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
        createdAt,
        expiresAt,
      };
      await this.local.set({
        [LOCAL_CREDENTIAL_ENVELOPE]: envelope,
        [LOCAL_CREDENTIAL_KEY]: key,
        [LOCAL_KEY_FINGERPRINT]: fingerprint,
      });
      return { retention: 'seven_days', fingerprint, expiresAt, fallback: false };
    } catch {
      // If AES-GCM or CryptoKey persistence is unavailable, fail closed and keep
      // the user on the documented session-only path.
      await this.removeRemembered();
      await this.session.set({
        [SESSION_API_KEY]: normalized,
        [SESSION_KEY_FINGERPRINT]: fingerprint,
        [SESSION_CREDENTIAL_RETENTION]: 'session',
      });
      return { retention: 'session', fingerprint, fallback: true };
    }
  }

  async load(): Promise<{ apiKey: string; status: CredentialStatus } | undefined> {
    await this.purgeExpired();
    const sessionValues = await this.session.get([SESSION_API_KEY, SESSION_KEY_FINGERPRINT]);
    if (typeof sessionValues[SESSION_API_KEY] === 'string' && sessionValues[SESSION_API_KEY].length >= 8) {
      const fingerprint = typeof sessionValues[SESSION_KEY_FINGERPRINT] === 'string' ? sessionValues[SESSION_KEY_FINGERPRINT] : undefined;
      return {
        apiKey: sessionValues[SESSION_API_KEY],
        status: { configured: true, retention: 'session', ...(fingerprint ? { fingerprint } : {}) },
      };
    }
    const values = await this.local.get([LOCAL_CREDENTIAL_ENVELOPE, LOCAL_CREDENTIAL_KEY, LOCAL_KEY_FINGERPRINT]);
    const envelope = parseCredentialEnvelope(values[LOCAL_CREDENTIAL_ENVELOPE]);
    const key = values[LOCAL_CREDENTIAL_KEY];
    if (!envelope || !isNonExtractableAesKey(key) || envelope.expiresAt <= this.now()) {
      if (values[LOCAL_CREDENTIAL_ENVELOPE] !== undefined || values[LOCAL_CREDENTIAL_KEY] !== undefined) await this.removeRemembered();
      return undefined;
    }
    try {
      const plaintext = await this.crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(envelope.iv) as unknown as BufferSource }, key, base64ToBytes(envelope.ciphertext) as unknown as BufferSource);
      const apiKey = new TextDecoder().decode(plaintext);
      if (apiKey.length < 8 || /[\r\n]/.test(apiKey)) throw new Error('Invalid decrypted credential.');
      const fingerprint = typeof values[LOCAL_KEY_FINGERPRINT] === 'string' ? values[LOCAL_KEY_FINGERPRINT] : undefined;
      return {
        apiKey,
        status: {
          configured: true,
          retention: 'seven_days',
          expiresAt: envelope.expiresAt,
          ...(fingerprint ? { fingerprint } : {}),
        },
      };
    } catch {
      await this.removeRemembered();
      return undefined;
    }
  }

  async status(): Promise<CredentialStatus> {
    const loaded = await this.load();
    return loaded?.status ?? { configured: false };
  }

  async forget(): Promise<void> {
    await Promise.all([
      this.session.remove([SESSION_API_KEY, SESSION_KEY_FINGERPRINT, SESSION_CREDENTIAL_RETENTION]),
      this.removeRemembered(),
    ]);
  }

  private async removeRemembered(): Promise<void> {
    await this.local.remove([LOCAL_CREDENTIAL_ENVELOPE, LOCAL_CREDENTIAL_KEY, LOCAL_KEY_FINGERPRINT]);
  }
}
