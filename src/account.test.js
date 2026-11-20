import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteAccount } from './account.js';

test('account deletion removes owned photos before deleting the auth user', async () => {
  const calls = [];
  let removed = false;
  const photos = {
    list: async path => ({ data: path === 'user' ? (removed ? [] : [{ name: 'book', id: null }]) : [{ name: 'cover.jpg', id: 'photo' }], error: null }),
    remove: async paths => { calls.push(['remove', paths]); removed = true; return { error: null }; },
  };
  await deleteAccount({ storage: { from: () => photos }, rpc: async name => { calls.push(['rpc', name]); return { error: null }; } }, 'user');
  assert.deepEqual(calls, [['remove', ['user/book/cover.jpg']], ['rpc', 'delete_my_account']]);
});
