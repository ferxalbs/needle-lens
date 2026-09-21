const SECRET_KEYS = /authorization|api[-_]?key|token|secret|password|cookie/i;

export function redactString(value: string, secret?: string): string {
  const withSecretRemoved = secret ? value.split(secret).join('[redacted]') : value;
  return withSecretRemoved
    .replace(/(authorization)\s*[:=]\s*Bearer\s+[^\s,;}]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[^\s,;}]+/gi, 'Bearer [redacted]')
    .replace(/(api[-_]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;}]+/gi, '$1=[redacted]');
}

export function redactUnknown(error: unknown, secret?: string): string {
  if (error instanceof Error) return redactString(error.message, secret);
  if (typeof error === 'string') return redactString(error, secret);
  return 'The provider request failed.';
}

export function redactRecord(
  value: Record<string, unknown>,
  secret?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEYS.test(key)) {
      result[key] = '[redacted]';
    } else if (typeof entry === 'string') {
      result[key] = redactString(entry, secret);
    } else {
      result[key] = entry;
    }
  }
  return result;
}
