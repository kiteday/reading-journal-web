import assert from 'node:assert/strict';
import test from 'node:test';
import { addReadingPlan, changeReadingPlanDate, removeReadingPlan } from './plans.js';

test('plans confirm insert, date change and removal with the server', async () => {
  const calls = [];
  const query = {
    select() { return this; }, single() { return Promise.resolve({ data: { id: 'plan-1' }, error: null }); },
    eq(field, id) { calls.push([field, id]); return this; },
  };
  const client = { from(table) { assert.equal(table, 'reading_plans'); return { insert(value) { calls.push(['insert', value]); return query; }, update(value) { calls.push(['update', value]); return query; }, delete() { calls.push(['delete']); return query; } }; } };
  await addReadingPlan(client, 'owner-1', { id: '123', title: '책', authorText: '저자' }, '2026-11-20', 'plan-1');
  await changeReadingPlanDate(client, 'plan-1', '2026-11-21');
  await removeReadingPlan(client, 'plan-1');
  assert.equal(calls[0][1].owner_id, 'owner-1');
  assert.equal(calls[0][1].provider_item_id, '123');
  assert.deepEqual(calls[1], ['update', { planned_on: '2026-11-21' }]);
  assert.deepEqual(calls.at(-1), ['id', 'plan-1']);
});
