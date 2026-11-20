import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createAppleNonce } from './appleNonce.js';

test('Apple nonce is random and sent to Apple as its SHA-256 hash', async () => {
  const first = await createAppleNonce();
  const second = await createAppleNonce();
  assert.notEqual(first.nonce, second.nonce);
  assert.equal(first.hashedNonce, createHash('sha256').update(first.nonce).digest('hex'));
});
