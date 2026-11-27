export function trustedImageUrl(value: string | undefined, origin: URL | null): string | null {
  if (!value || !origin) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== origin.origin ||
      !url.pathname.startsWith(origin.pathname) ||
      url.username ||
      url.password
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}
