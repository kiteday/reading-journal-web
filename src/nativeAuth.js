export const NATIVE_AUTH_CALLBACK = 'com.kiteday.readingjournal.prototype://auth/callback';

export function parseNativeAuthCallback(value) {
  try {
    const url = new URL(value);
    if (`${url.protocol}//${url.host}${url.pathname}` !== NATIVE_AUTH_CALLBACK) return null;
    return { code: url.searchParams.get('code'), error: url.searchParams.get('error_description') || url.searchParams.get('error') };
  } catch {
    return null;
  }
}
