export function isEligibleXUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'x.com' || url.hostname === 'www.x.com');
  } catch {
    return false;
  }
}
