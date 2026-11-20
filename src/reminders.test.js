import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlanReminderSettings, loadReminderSettings, plannedReminderAt, plannedReminderBody, readingReminderStatus, reminderDate, reminderId, savePlanReminderSettings, saveReminderSettings } from './reminders.js';

test('reminders are off by default and stored separately for each account', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.deepEqual(loadReminderSettings(storage, 'a'), { enabled: false, days: 14, activatedOn: '' });
  saveReminderSettings(storage, 'a', { enabled: true, days: 19, activatedOn: '2026-11-07' });
  assert.equal(loadReminderSettings(storage, 'a').days, 19);
  assert.deepEqual(loadReminderSettings(storage, 'b'), { enabled: false, days: 14, activatedOn: '' });
  saveReminderSettings(storage, 'a', { enabled: true, days: 366, activatedOn: '2026-11-07' });
  assert.equal(loadReminderSettings(storage, 'a').days, 14);
});

test('a reminder is proposed once after the delay, or the day after enabling if overdue', () => {
  assert.equal(reminderDate('2026-11-07', 14, '2026-11-08'), '2026-11-21');
  assert.equal(reminderDate('2026-11-07', 19, '2026-11-08'), '2026-11-26');
  assert.equal(reminderDate('2026-10-01', 14, '2026-11-07'), '2026-11-08');
  assert.ok(reminderId('a-record-id') > 0);
  assert.equal(reminderId('a-record-id'), reminderId('a-record-id'));
});

test('planned reading reminders are account-specific and stay before the reading date', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  savePlanReminderSettings(storage, 'a', { enabled: true, days: 3 });
  assert.deepEqual(loadPlanReminderSettings(storage, 'a'), { enabled: true, days: 3 });
  assert.deepEqual(loadPlanReminderSettings(storage, 'b'), { enabled: false, days: 1 });
  assert.equal(plannedReminderAt('2026-11-20', 3, new Date('2026-11-12T09:00:00')).getDate(), 17);
  assert.equal(plannedReminderAt('2026-11-13', 3, new Date('2026-11-12T09:00:00')).getTime(), new Date('2026-11-12T09:01:00').getTime());
  assert.equal(plannedReminderAt('2026-11-12', 1, new Date('2026-11-12T11:00:00')), null);
});

test('planned reminder rotates six messages that include the book title', () => {
  const messages = Array.from({ length: 6 }, (_, index) => plannedReminderBody('달과 6펜스', () => index / 6));
  assert.equal(new Set(messages).size, 6);
  assert.ok(messages.every(message => message.includes('달과 6펜스')));
});

test('reminder status checks the actual pending alert for this account', async () => {
  const plugin = {
    checkPermissions: async () => ({ display: 'granted' }),
    getPending: async () => ({ notifications: [
      { extra: { readingJournalReminder: true, userId: 'other' }, schedule: { at: '2026-11-14T01:00:00Z' } },
      { extra: { readingJournalReminder: true, readingJournalPlan: true, userId: 'me' }, schedule: { at: '2026-11-14T01:00:00Z' } },
      { extra: { readingJournalReminder: true, userId: 'me' }, schedule: { at: '2026-11-15T01:00:00Z' } },
    ] }),
  };
  assert.deepEqual(await readingReminderStatus('me', plugin), { permission: 'granted', next: '2026-11-15T01:00:00Z' });
});
