import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { dayKey, monthCells, monthReport, recordsStartedOn } from './calendar.js';

test('calendar starts on Sunday and includes leap day', () => {
  const cells = monthCells(2024, 1);
  assert.equal(cells[4], 1);
  assert.equal(cells[32], 29);
  assert.equal(cells.length, 35);
  assert.equal(dayKey(2024, 1, 9), '2024-02-09');
});

test('a finished book appears only on its start day', () => {
  const records = [{ started_on: '2026-11-01', completed_on: '2026-11-13' }];
  assert.deepEqual(recordsStartedOn(records, '2026-11-01'), records);
  assert.deepEqual(recordsStartedOn(records, '2026-11-13'), []);
});

test('monthly report counts starts and completions by their own dates', () => {
  const records = [
    { started_on: '2026-10-31', completed_on: '2026-11-13' },
    { started_on: '2026-11-02', completed_on: '2026-11-10' },
    { started_on: '2026-11-12', completed_on: null },
  ];
  const report = monthReport(records, 2026, 10);
  assert.equal(report.started, 2);
  assert.deepEqual(report.finished, [records[0], records[1]]);
});
