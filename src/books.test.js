import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBook, looksLikeBookSpine, startManualReading, validateBook, yes24ImageURL, saveShelfNote } from './books.js';

test('uses the official YES24 image only for a numeric product ID', () => {
  assert.equal(yes24ImageURL({ source: 'yes24', provider_item_id: '13137546' }), 'https://image.yes24.com/goods/13137546/SIDE/L');
  assert.equal(yes24ImageURL({ source: 'yes24', provider_item_id: '13137546' }, 'COVER'), 'https://image.yes24.com/goods/13137546/L');
  assert.equal(yes24ImageURL({ source: 'manual', provider_item_id: '13137546' }), null);
  assert.equal(yes24ImageURL({ source: 'yes24', provider_item_id: '../bad' }), null);
});

test('a full-cover placeholder does not replace the shelf title spine', () => {
  assert.equal(looksLikeBookSpine(36, 400), true);
  assert.equal(looksLikeBookSpine(280, 400), false);
});

test('shelf note save includes the version and reports a conflict without discarding text', async () => {
  let input;
  const client = { rpc: async (_name, values) => (input = values, { data: { status: 'conflict', version: 3, content: 'server' }, error: null }) };
  const result = await saveShelfNote(client, { id: 'book-1', version: 2 }, 'my text', 'request-1');
  assert.equal(input.p_expected_version, 2);
  assert.equal(input.p_content, 'my text');
  assert.equal(result.status, 'conflict');
});

test('requires a title and validates ISBN format and checksum', () => {
  assert.ok(validateBook({ isbn: '', title: '' }));
  assert.equal(validateBook({ isbn: '978-0-306-40615-7', title: 'A title' }), null);
  assert.equal(validateBook({ isbn: '0-306-40615-2', title: 'A title' }), null);
  assert.ok(validateBook({ isbn: '978-0-306-40615-0', title: 'A title' }));
  assert.ok(validateBook({ isbn: '123', title: 'A title' }));
  assert.ok(validateBook({ isbn: '', title: '  ' }));
});

test('calls put_manual_book then confirms by listing server books', async () => {
  const calls = [];
  const client = {
    rpc: async (...args) => (calls.push(args), { data: { id: 'book-1' }, error: null }),
    from: name => ({ select: fields => ({ order: async (...order) => (calls.push([name, fields, ...order]), { data: [{ id: 'book-1', is_shelved: true }], error: null }) }) }),
  };
  assert.equal((await addBook(client, { isbn: ' 978-0-306-40615-7 ', title: ' A title ', author: '', bookId: 'book-1' })).books.length, 1);
  assert.equal(calls[0][0], 'put_manual_book');
  assert.equal(calls[0][1].p_book_id, 'book-1');
  assert.equal(calls[0][1].p_isbn, '9780306406157');
  assert.equal(calls[1][0], 'books');
});

test('manual start uses the canonical book ID and stable record ID', async () => {
  const calls = [];
  const client = {
    rpc: async (name, values) => {
      calls.push([name, values]);
      return { data: name === 'put_manual_book' ? { id: 'canonical-book' } : { record_id: 'record-1', started_on: '2026-11-12' }, error: null };
    },
    from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
  };
  await startManualReading(client, { isbn: '', title: '내 책', author: '', bookId: 'new-book' }, '2026-11-12', 'record-1');
  assert.equal(calls[1][1].p_book_id, 'canonical-book');
  assert.equal(calls[1][1].p_record_id, 'record-1');
});

test('does not treat an unconfirmed RPC response as success', async () => {
  const client = { rpc: async () => ({ data: null, error: null }) };
  await assert.rejects(addBook(client, { isbn: '', title: 'A title', author: '', bookId: 'stable-id' }), /확인하지 못했습니다/);
});
