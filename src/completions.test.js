import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { finishReading, saveCompletion, saveReflection, searchYes24, startReading } from './completions.js';

test('YES24 search uses the proxy without asking for ISBN', async () => {
  const originalFetch = globalThis.fetch;
  let called;
  globalThis.fetch = async url => (called = url, { ok: true, json: async () => ({ items: [{ id: '123', title: '책' }] }) });
  try {
    assert.deepEqual(await searchYes24('https://search.example/', ' 책 '), [{ id: '123', title: '책' }]);
    assert.equal(called.searchParams.get('q'), '책');
  } finally { globalThis.fetch = originalFetch; }
});

test('YES24 search omits multi-volume sets but keeps single volumes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [
    { id: '1', title: '해리 포터와 마법사의 돌 1~2권 세트' },
    { id: '2', title: '해리 포터와 마법사의 돌 1' },
  ] }) });
  try { assert.deepEqual((await searchYes24('https://search.example/', '해리 포터')).map(item => item.id), ['2']); }
  finally { globalThis.fetch = originalFetch; }
});

test('saving a YES24 completion sends stable IDs and confirms the server response', async () => {
  let call;
  const client = { rpc: async (...args) => (call = args, { data: { record_id: 'record-1', book_id: 'book-1' }, error: null }) };
  await saveCompletion(client, { id: '123', isbn: null, title: '책', authorText: '저자' }, '2026-10-21', ' 소감 ', 'record-1', 'book-1');
  assert.equal(call[0], 'put_completion');
  assert.equal(call[1].p_provider_item_id, '123');
  assert.equal(call[1].p_reflection, '소감');
  assert.equal(call[1].p_completed_on, '2026-10-21');
});

test('editing a reflection sends the expected version and preserves a conflict', async () => {
  let call;
  const client = { rpc: async (...args) => (call = args, {
    data: { status: 'conflict', version: 3, content: '다른 기기의 글' }, error: null,
  }) };
  const result = await saveReflection(client, { id: 'record-1', version: 2 }, '내 글', 'request-1');
  assert.equal(call[0], 'save_reflection');
  assert.equal(call[1].p_expected_version, 2);
  assert.equal(call[1].p_content, '내 글');
  assert.equal(result.status, 'conflict');
});

test('reading starts without a completion date and finishes the same record', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: name === 'start_reading'
      ? { record_id: 'record-1', book_id: 'book-1', started_on: '2026-11-07' }
      : { record_id: 'record-1', completed_on: '2026-11-14' }, error: null };
  } };
  await startReading(client, { id: '123', isbn: null, title: '책', authorText: '저자' }, '2026-11-07', 'record-1', 'book-1');
  await finishReading(client, 'record-1', '2026-11-14');
  assert.equal(calls[0][1].p_started_on, '2026-11-07');
  assert.equal('p_completed_on' in calls[0][1], false);
  assert.equal(calls[1][1].p_record_id, 'record-1');
  assert.equal(calls[1][1].p_completed_on, '2026-11-14');
});
