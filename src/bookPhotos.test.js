import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachBookPhotos, cropRect, uploadBookPhoto, visibleVideoRect } from './bookPhotos.js';

test('crop stays inside the photo and keeps the requested book ratio', () => {
  for (const ratio of [2 / 3, 1 / 5]) {
    const rect = cropRect(1200, 1600, ratio, 0.8, 1.2, -0.2);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= 1200 && rect.y + rect.height <= 1600);
    assert.ok(Math.abs(rect.width / rect.height - ratio) < 1e-10);
  }
});

test('camera capture matches the visible object-fit cover area', () => {
  assert.deepEqual(visibleVideoRect(1920, 1080, 350, 460), { x: 549.1304347826087, y: 0, width: 821.7391304347826, height: 1080 });
  assert.deepEqual(visibleVideoRect(1080, 1920, 350, 460), { x: 0, y: 250.28571428571433, width: 1080, height: 1419.4285714285713 });
});

test('signed private photos attach only to matching book paths', async () => {
  const client = { storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `https://signed.example/${path}` })), error: null }) }) } };
  const [book] = await attachBookPhotos(client, [{ cover_path: 'user/book/cover.jpg', spine_path: null }]);
  assert.equal(book.cover_url, 'https://signed.example/user/book/cover.jpg');
  assert.equal(book.spine_url, undefined);
});

test('upload confirms the server path before reporting success', async () => {
  const calls = [];
  const client = {
    storage: { from: () => ({ upload: async (...args) => (calls.push(args), { error: null }) }) },
    rpc: async (_name, args) => ({ data: { path: `user/${args.p_book_id}/${args.p_kind}.jpg` }, error: null }),
  };
  await uploadBookPhoto(client, 'user', 'book', 'spine', new Blob(['photo']));
  assert.equal(calls[0][0], 'user/book/spine.jpg');
  assert.equal(calls[0][2].upsert, true);
});
