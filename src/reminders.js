import { LocalNotifications } from '@capacitor/local-notifications';

const storageKey = userId => `reading-journal:reminders:${userId}`;

export function loadReminderSettings(storage, userId) {
  try {
    const value = JSON.parse(storage.getItem(storageKey(userId)) || '{}');
    return { enabled: value.enabled === true, days: Number.isInteger(value.days) && value.days >= 1 && value.days <= 365 ? value.days : 14, activatedOn: typeof value.activatedOn === 'string' ? value.activatedOn : '' };
  } catch { return { enabled: false, days: 14, activatedOn: '' }; }
}

export function saveReminderSettings(storage, userId, settings) {
  storage.setItem(storageKey(userId), JSON.stringify(settings));
}

const planStorageKey = userId => `reading-journal:plan-reminders:${userId}`;

export function loadPlanReminderSettings(storage, userId) {
  try {
    const value = JSON.parse(storage.getItem(planStorageKey(userId)) || '{}');
    return { enabled: value.enabled === true, days: Number.isInteger(value.days) && value.days >= 1 && value.days <= 30 ? value.days : 1 };
  } catch { return { enabled: false, days: 1 }; }
}

export function savePlanReminderSettings(storage, userId, settings) {
  storage.setItem(planStorageKey(userId), JSON.stringify(settings));
}

export function reminderDate(startedOn, days, activatedOn) {
  const date = new Date(`${startedOn}T10:00:00`);
  date.setDate(date.getDate() + days);
  const earliest = new Date(`${activatedOn}T10:00:00`);
  earliest.setDate(earliest.getDate() + 1);
  if (date < earliest) date.setTime(earliest.getTime());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function reminderId(recordId) {
  let hash = 2166136261;
  for (const char of recordId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash & 0x7fffffff) || 1;
}

export async function requestReminderPermission() {
  return (await LocalNotifications.requestPermissions()).display === 'granted';
}

export async function readingReminderStatus(userId, plugin) {
  plugin ||= LocalNotifications;
  const permission = (await plugin.checkPermissions()).display;
  const { notifications } = await plugin.getPending();
  const next = notifications.filter(item => item.extra?.readingJournalReminder && !item.extra.readingJournalPlan && item.extra.userId === userId)
    .map(item => item.schedule?.at).filter(Boolean).sort()[0] || null;
  return { permission, next };
}

export async function clearReadingReminders(kind) {
  const { notifications } = await LocalNotifications.getPending();
  const ours = notifications.filter(item => item.extra?.readingJournalReminder && (!kind || (kind === 'completion' ? !item.extra.readingJournalPlan : item.extra.readingJournalPlan)));
  if (ours.length) await LocalNotifications.cancel({ notifications: ours.map(({ id }) => ({ id })) });
}

export async function syncReadingReminders(settings, records, userId, now = new Date()) {
  const dueDates = settings.enabled ? [...new Set(records.filter(record => !record.completed_on).map(record => reminderDate(record.started_on, settings.days, settings.activatedOn)))].filter(date => new Date(`${date}T10:00:00`) > now).sort() : [];
  if (dueDates.length && (await LocalNotifications.checkPermissions()).display !== 'granted') throw new Error('기기 설정에서 알림 권한을 허용해 주세요.');
  await clearReadingReminders('completion');
  if (dueDates.length) await LocalNotifications.schedule({ notifications: dueDates.map(date => ({
    id: reminderId(`${userId}:${date}`),
    title: '읽고 있는 책, 다 읽으셨나요?',
    body: '완독했다면 날짜를 남겨 보세요.',
    schedule: { at: new Date(`${date}T10:00:00`) },
    extra: { readingJournalReminder: true, userId },
  })) });
  return dueDates.length;
}

export function plannedReminderAt(plannedOn, days, now = new Date()) {
  const start = new Date(`${plannedOn}T10:00:00`);
  if (start <= now) return null;
  const due = new Date(start);
  due.setDate(due.getDate() - days);
  return due > now ? due : new Date(now.getTime() + 60_000);
}

export function plannedReminderBody(title, random = Math.random) {
  const messages = [
    `《${title}》가 기다리고 있어요!`,
    `곧 《${title}》를 펼칠 날이에요.`,
    `《${title}》와 만날 준비가 됐나요?`,
    `책장 속 《${title}》가 당신을 기다려요.`,
    `이번엔 《${title}》의 첫 장을 열어볼까요?`,
    `《${title}》를 읽기로 한 날이 다가와요.`,
  ];
  return messages[Math.floor(random() * messages.length)];
}

export async function syncPlannedReminders(settings, plans, userId, now = new Date()) {
  const notifications = settings.enabled ? plans.slice(0, 50).flatMap(plan => {
    const at = plannedReminderAt(plan.planned_on, settings.days, now);
    return at ? [{ id: reminderId(`plan:${userId}:${plan.id}`), title: '읽을 책을 준비해 볼까요?', body: plannedReminderBody(plan.title), schedule: { at }, extra: { readingJournalReminder: true, readingJournalPlan: true, userId } }] : [];
  }) : [];
  if (notifications.length && (await LocalNotifications.checkPermissions()).display !== 'granted') throw new Error('기기 설정에서 알림 권한을 허용해 주세요.');
  await clearReadingReminders('plan');
  if (notifications.length) await LocalNotifications.schedule({ notifications });
  return notifications.length;
}
