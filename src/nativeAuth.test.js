import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseNativeAuthCallback } from './nativeAuth.js';

test('accepts only the prototype app callback and extracts the PKCE code', () => {
  assert.deepEqual(parseNativeAuthCallback('com.kiteday.readingjournal.prototype://auth/callback?code=one'), { code: 'one', error: null });
  assert.equal(parseNativeAuthCallback('com.kiteday.readingjournal.prototype://other/callback?code=one'), null);
  assert.equal(parseNativeAuthCallback('https://example.com/?code=one'), null);
  assert.equal(parseNativeAuthCallback('broken url'), null);
});
