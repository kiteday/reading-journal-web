export function dayKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function recordsStartedOn(records, day) {
  return records.filter(record => record.started_on === day);
}

export function monthReport(records, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  return {
    started: records.filter(record => record.started_on?.startsWith(prefix)).length,
    finished: records.filter(record => record.completed_on?.startsWith(prefix))
      .sort((a, b) => b.completed_on.localeCompare(a.completed_on)),
  };
}

export function monthCells(year, month) {
  const offset = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const size = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length: size }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= count ? day : null;
  });
}
