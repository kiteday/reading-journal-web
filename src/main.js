import { createClient } from '@supabase/supabase-js';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { BOOK_COLUMNS, looksLikeBookSpine, saveShelfNote, startManualReading, yes24ImageURL } from './books.js';
import { attachBookPhotos, cropRect, photoBlob, uploadBookPhoto, visibleVideoRect } from './bookPhotos.js';
import { dayKey, monthCells, monthReport, recordsStartedOn } from './calendar.js';
import { finishReading, saveReflection, searchYes24, startReading } from './completions.js';
import { NATIVE_AUTH_CALLBACK, parseNativeAuthCallback } from './nativeAuth.js';
import { createAppleNonce } from './appleNonce.js';
import { deleteAccount } from './account.js';
import { clearReadingReminders, loadPlanReminderSettings, loadReminderSettings, readingReminderStatus, requestReminderPermission, savePlanReminderSettings, saveReminderSettings, syncPlannedReminders, syncReadingReminders } from './reminders.js';
import { addReadingPlan, changeReadingPlanDate, removeReadingPlan } from './plans.js';
import './style.css';

const root = document.querySelector('#app');
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const searchURL = import.meta.env.VITE_BOOK_SEARCH_BASE_URL;
let shelfObserver;
let banner;
if (!url || !key) {
  root.innerHTML = `<section class="panel"><p class="eyebrow">READING JOURNAL</p><h1>서가를 시작해요</h1><p>Supabase 설정이 필요합니다. <code>web/.env.example</code>을 복사해 <code>web/.env</code>를 만들고 URL과 publishable key를 입력한 뒤 개발 서버를 다시 시작해 주세요.</p></section>`;
} else {
  const native = Capacitor.isNativePlatform();
  const supabase = createClient(url, key, native ? { auth: { flowType: 'pkce', detectSessionInUrl: false } } : undefined);
  let currentUserId = Symbol('uninitialized');
  supabase.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null;
    if (userId === currentUserId) return;
    currentUserId = userId;
    render(supabase, session, native);
  });
  if (native) {
    let handledCode;
    const handleCallback = async value => {
      const callback = parseNativeAuthCallback(value);
      if (!callback) return;
      Browser.close().catch(() => {});
      if (callback.error || !callback.code) {
        showAuthError(callback.error || '로그인 인증 코드가 없습니다.');
        return;
      }
      if (handledCode === callback.code) return;
      handledCode = callback.code;
      const { error } = await supabase.auth.exchangeCodeForSession(callback.code);
      if (error) showAuthError('로그인을 완료하지 못했어요. 다시 시도해 주세요.');
    };
    App.addListener('appUrlOpen', ({ url }) => handleCallback(url));
    App.getLaunchUrl().then(({ url }) => { if (url) handleCallback(url); });
  }
}

function showAuthError(message) {
  const content = root.querySelector('#content');
  if (content) content.insertAdjacentHTML('beforeend', `<p class="error">${escapeHtml(message)}</p>`);
}

async function render(client, session, native) {
  shelfObserver?.disconnect();
  root.classList.toggle('app', !!session);
  root.innerHTML = `<header><span class="eyebrow">READING JOURNAL</span><a id="privacy-link" href="https://kiteday.github.io/readingjournal/">개인정보처리방침</a><button id="account-open" class="quiet" type="button" hidden>계정</button><button id="logout" class="quiet" hidden>로그아웃</button></header><section id="content" class="panel">세션을 확인하고 있어요…</section>`;
  const content = root.querySelector('#content');
  const logout = root.querySelector('#logout');
  if (native) root.querySelector('#privacy-link').onclick = event => {
    event.preventDefault();
    Browser.open({ url: event.currentTarget.href });
  };
  if (!session) {
    if (native) { stopBanner(); clearReadingReminders().catch(() => {}); }
    content.innerHTML = `<h1>나만의 서가</h1><p>로그인하면 어디서든 내 책을 이어 볼 수 있어요.</p><div class="actions"><button data-provider="google">Google로 계속</button><button data-provider="apple" class="secondary" ${native ? '' : 'disabled'}>Apple로 계속</button></div>`;
    content.querySelectorAll('[data-provider]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        if (native && button.dataset.provider === 'apple') {
          const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
          const { nonce, hashedNonce } = await createAppleNonce();
          const { response } = await SignInWithApple.authorize({ scopes: 'email name', nonce: hashedNonce });
          if (!response?.identityToken) throw new Error('Apple 인증 정보가 없습니다.');
          const { error } = await client.auth.signInWithIdToken({ provider: 'apple', token: response.identityToken, nonce });
          if (error) throw error;
        } else {
          const { data, error } = await client.auth.signInWithOAuth({ provider: button.dataset.provider, options: { redirectTo: native ? NATIVE_AUTH_CALLBACK : new URL(import.meta.env.BASE_URL, location.origin).href, skipBrowserRedirect: native, queryParams: button.dataset.provider === 'google' ? { prompt: 'select_account' } : undefined } });
          if (error) throw error;
          if (native && data?.url) await Browser.open({ url: data.url });
        }
      } catch (error) { showAuthError(error.message || '로그인을 시작하지 못했어요.'); }
      button.disabled = false;
    });
    return;
  }
  const accountDialog = document.createElement('dialog');
  accountDialog.id = 'account-dialog';
  accountDialog.innerHTML = '<div class="dialog-heading"><h2>계정·설정</h2><button id="account-close" class="quiet" type="button">닫기</button></div><section class="settings-section"><small>내 계정</small><p id="account-email"></p></section><section class="settings-section"><div class="settings-title"><h3>완독 확인 알림</h3><p>읽고 있는 책의 완독을 잊지 않도록 도와드려요.</p></div><label class="settings-toggle"><span>알림 받기<small>책 제목은 알림에 표시되지 않아요.</small></span><input id="reminder-enabled" type="checkbox" role="switch"></label><div class="settings-frequency"><label for="reminder-days">알림 시점</label><div class="settings-number">읽기 시작 후 <input id="reminder-days" type="number" min="1" max="365" step="1" inputmode="numeric" aria-label="알림까지 일수"> 일 뒤</div></div><p id="reminder-count"></p><p id="reminder-message" role="status"></p><small class="settings-footnote">읽기 시작 후 한 번만 보내며, 이 기기에서 설정돼요.</small></section><section class="settings-section"><div class="settings-title"><h3>읽을 책 미리 알림</h3><p>읽기로 한 날짜 전에 한 번 알려드려요.</p></div><label class="settings-toggle"><span>알림 받기<small>책 제목은 알림에 표시되지 않아요.</small></span><input id="plan-reminder-enabled" type="checkbox" role="switch"></label><div class="settings-frequency"><label for="plan-reminder-days">알림 시점</label><div class="settings-number">읽을 날짜 <input id="plan-reminder-days" type="number" min="1" max="30" step="1" inputmode="numeric" aria-label="읽을 날짜 전 일수"> 일 전</div></div><p id="plan-reminder-message" role="status"></p><small class="settings-footnote">이 기기에서만 알림이 울려요.</small></section>';
  root.append(accountDialog);
  accountDialog.querySelector('#plan-reminder-enabled').closest('.settings-toggle').querySelector('small').textContent = '책 제목이 잠금 화면에 표시될 수 있어요.';
  accountDialog.querySelector('#plan-reminder-message').insertAdjacentHTML('afterend', '<button id="plan-manage" class="quiet" type="button">읽을 책 등록·관리</button>');
  accountDialog.querySelector('#account-email').textContent = session.user.email || '이메일을 제공하지 않은 계정';
  const accountActions = document.createElement('div');
  accountActions.className = 'settings-actions';
  const deleteButton = document.createElement('button');
  deleteButton.className = 'quiet';
  deleteButton.textContent = '계정 삭제';
  deleteButton.onclick = async () => {
    if (!confirm('서가, 독서 기록, 사진과 로그인 계정을 모두 영구 삭제할까요? 되돌릴 수 없어요.')) return;
    deleteButton.disabled = true;
    try {
      await deleteAccount(client, session.user.id);
      for (const storageKey of Object.keys(localStorage)) {
        if (storageKey.startsWith('reading-journal:') && storageKey.includes(session.user.id)) localStorage.removeItem(storageKey);
      }
      if (native) await clearReadingReminders().catch(() => {});
      await client.auth.signOut({ scope: 'local' });
    } catch (error) {
      alert(error.message || '계정을 삭제하지 못했어요. 다시 시도해 주세요.');
      deleteButton.disabled = false;
    }
  };
  accountActions.append(deleteButton);
  accountActions.append(logout);
  accountDialog.append(accountActions);
  root.querySelector('#account-open').hidden = false;
  const closeAccount = afterClose => {
    if (!accountDialog.open || accountDialog.classList.contains('closing')) return;
    accountDialog.classList.add('closing');
    setTimeout(() => {
      accountDialog.close();
      accountDialog.classList.remove('closing');
      afterClose?.();
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240);
  };
  root.querySelector('#account-open').onclick = () => { accountDialog.showModal(); drawReminders(); };
  accountDialog.querySelector('#account-close').onclick = () => closeAccount();
  accountDialog.oncancel = event => { event.preventDefault(); closeAccount(); };
  let swipeStart;
  accountDialog.addEventListener('touchstart', event => {
    swipeStart = [event.touches[0].clientX, event.touches[0].clientY];
  }, { passive: true });
  accountDialog.addEventListener('touchend', event => {
    if (!swipeStart) return;
    const dx = event.changedTouches[0].clientX - swipeStart[0];
    const dy = event.changedTouches[0].clientY - swipeStart[1];
    swipeStart = undefined;
    if (dx > 80 && dx > Math.abs(dy) * 1.5) closeAccount();
  });
  accountDialog.addEventListener('touchcancel', () => { swipeStart = undefined; });
  let openSwipeStart;
  content.addEventListener('touchstart', event => {
    openSwipeStart = !accountDialog.open && event.touches[0].clientX > innerWidth - 48
      ? [event.touches[0].clientX, event.touches[0].clientY] : undefined;
  }, { passive: true });
  content.addEventListener('touchend', event => {
    if (!openSwipeStart) return;
    const dx = event.changedTouches[0].clientX - openSwipeStart[0];
    const dy = event.changedTouches[0].clientY - openSwipeStart[1];
    openSwipeStart = undefined;
    if (dx < -80 && -dx > Math.abs(dy) * 1.5) accountDialog.showModal();
  });
  logout.hidden = false;
  logout.onclick = async () => { if (native) await clearReadingReminders().catch(() => {}); await client.auth.signOut(); };
  content.classList.add('app-panel');
  content.innerHTML = `<section id="shelf-screen" class="screen"><div class="heading"><h1>서가</h1></div><div id="books" class="books" aria-label="내 책장">불러오는 중…</div><div class="pager"><button id="page-prev" class="quiet" aria-label="이전 서가">‹</button><span id="page-position">1 / 1</span><button id="page-next" class="quiet" aria-label="다음 서가">›</button></div></section><section id="calendar-screen" class="screen" hidden><div class="heading"><h1>독서 달력</h1><div class="heading-actions"><button id="plans-open" class="quiet">읽을 책</button><button id="add-completion">+ 기록</button></div></div><div class="month-nav"><button id="month-prev" class="quiet" aria-label="이전 달">‹</button><strong id="month-title"></strong><button id="month-next" class="quiet" aria-label="다음 달">›</button></div><div id="calendar-grid" class="calendar-grid"></div><p id="calendar-message" aria-live="polite"></p></section><section id="journal-screen" class="screen" hidden><div class="heading"><h1>독서 리포트</h1></div><div class="month-nav"><button id="report-prev" class="quiet" aria-label="이전 달 리포트">‹</button><button id="report-title" class="month-title" type="button" aria-label="리포트 연도와 월 선택"></button><button id="report-next" class="quiet" aria-label="다음 달 리포트">›</button></div><div class="report-summary"><p>읽기 시작 <strong id="report-started">0</strong>권</p><p>완독 <strong id="report-finished">0</strong>권</p></div><h2 class="report-heading">완독한 책</h2><div id="journal-feed" class="journal-feed"></div></section><nav class="tab-bar" aria-label="주요 화면"><button data-tab="shelf" aria-current="page">서가</button><button data-tab="calendar">독서 달력</button><button data-tab="journal">리포트</button></nav><dialog id="search-dialog"><button id="search-close" class="quiet" type="button">닫기</button><h2>책 검색</h2><p id="search-day"></p><form id="search-form"><label>책 제목이나 저자<input name="query" placeholder="책 제목이나 저자" required></label><button>검색</button></form><div id="search-results" aria-live="polite"></div><form id="completion-form" hidden><h3 id="selected-title"></h3><label><span id="reading-date-label">시작일</span><input name="started_on" type="date" required></label><button id="completion-save">읽기 시작</button><p id="completion-message" aria-live="polite"></p></form></dialog>`;
  if (native) {
    content.querySelector('.tab-bar').insertAdjacentHTML('afterend', '<div class="ad-slot" aria-label="광고 영역">광고 영역</div>');
    startBanner();
  }
  content.insertAdjacentHTML('beforeend', `
    <dialog id="report-month-dialog"><div class="dialog-heading"><h2>리포트 날짜 선택</h2><button id="report-month-close" class="quiet" type="button">닫기</button></div><form id="report-month-form"><label>연도<input name="year" type="number" min="1900" max="2100" required></label><label>월<select name="month">${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}">${index + 1}월</option>`).join('')}</select></label><button>이동</button></form></dialog>
    <dialog id="plans-dialog"><div class="dialog-heading"><h2>앞으로 읽을 책</h2><button id="plans-close" class="quiet" type="button">닫기</button></div><button id="plans-add" type="button">+ 읽을 책 담기</button><div id="plans-list" class="day-records"></div><p id="plans-message" role="status"></p></dialog>
    <dialog id="day-dialog"><div class="dialog-heading"><h2 id="day-title"></h2><button id="day-close" class="quiet" type="button">닫기</button></div><button id="day-add" type="button">+ 이 날짜에 기록</button><div id="day-records" class="day-records"></div></dialog>
    <dialog id="book-dialog" aria-labelledby="book-title"><div class="dialog-heading"><h2 id="book-title" class="sr-only"></h2><button id="book-close" class="quiet" type="button">닫기</button></div><div id="book-stage" class="book-stage"><div class="book-paper"><h3>메모</h3><p id="book-note-view"></p><button id="book-edit" type="button">수정</button><form id="book-note-form"><textarea id="book-note" maxlength="5000" aria-label="서가 책 메모"></textarea><button id="book-save">저장</button></form><p id="book-message" aria-live="polite"></p><blockquote id="book-server-note" hidden></blockquote></div><div class="book-cover"><img id="book-cover-image" alt="" hidden><strong id="book-cover-title"></strong></div></div></dialog>
    <dialog id="reflection-dialog" aria-labelledby="reflection-title"><div class="dialog-heading"><h2 id="reflection-title">독서글 수정</h2><button id="reflection-close" class="quiet" type="button">닫기</button></div><p id="reflection-book"></p><form id="reflection-form"><label>내 독서글<textarea id="reflection-text" maxlength="10000" rows="12"></textarea></label><button id="reflection-save">저장</button></form><p id="reflection-message" aria-live="polite"></p><blockquote id="reflection-server" hidden></blockquote></dialog>
    <dialog id="finish-dialog"><div class="dialog-heading"><h2>완독 기록</h2><button id="finish-close" class="quiet" type="button">닫기</button></div><p id="finish-book"></p><form id="finish-form"><label>완독일<input name="completed_on" type="date" required></label><button id="finish-save">완독 기록하기</button></form><p id="finish-message" aria-live="polite"></p></dialog>
  `);
  const dialog = content.querySelector('#search-dialog');
  dialog.querySelector('#search-results').insertAdjacentHTML('afterend', '<button id="manual-open" class="quiet" type="button">찾는 책이 없나요? 직접 등록</button>');
  content.insertAdjacentHTML('beforeend', `<dialog id="manual-dialog"><div class="dialog-heading"><h2>책 직접 등록</h2><button id="manual-close" class="quiet" type="button">닫기</button></div><form id="manual-form"><label>제목<input name="title" maxlength="300" required></label><label>저자 (선택)<input name="author" maxlength="300"></label><label>ISBN (선택)<input name="isbn" inputmode="numeric"></label><label>시작일<input name="started_on" type="date" required></label><div class="manual-photos"><div><strong>표지 (선택)</strong><img id="manual-cover-preview" alt="촬영한 표지 사진" hidden><button type="button" data-camera="cover" class="quiet">촬영</button></div><div><strong>책등 (선택)</strong><img id="manual-spine-preview" alt="촬영한 책등 사진" hidden><button type="button" data-camera="spine" class="quiet">촬영</button></div></div><button id="manual-save">서가에 꽂고 읽기 시작</button><p id="manual-message" aria-live="polite"></p></form></dialog><dialog id="camera-dialog"><div class="dialog-heading"><h2 id="camera-title">책 촬영</h2><button id="camera-close" class="quiet" type="button">닫기</button></div><div id="camera-frame"><video id="camera-video" autoplay playsinline muted></video><span id="camera-guide" aria-hidden="true"></span></div><p>책을 선 안에 맞춰 주세요.</p><button id="camera-shoot" type="button">촬영</button></dialog><dialog id="crop-dialog"><div class="dialog-heading"><h2>사진 자르기</h2><button id="crop-close" class="quiet" type="button">취소</button></div><p>사진을 터치해 자를 위치를 옮겨 주세요.</p><div id="crop-frame"><canvas id="crop-canvas" aria-label="촬영한 책 사진"></canvas><span id="crop-guide" aria-hidden="true"></span></div><label>자르기 범위<input id="crop-size" type="range" min="30" max="100" value="85"></label><div class="crop-actions"><button id="crop-retake" class="quiet" type="button">다시 촬영</button><button id="crop-save" type="button">이대로 사용</button></div><p id="crop-message" class="error" role="status"></p></dialog>`);
  const list = content.querySelector('#books');
  content.addEventListener('error', event => {
    if (event.target.matches('.spine img, .calendar-day img')) event.target.hidden = true;
    if (event.target.matches('#book-cover-image')) event.target.hidden = true;
  }, true);
  content.addEventListener('load', event => {
    if (event.target.matches('.spine img')) {
      if (event.target.parentElement.dataset.source === 'yes24' && !looksLikeBookSpine(event.target.naturalWidth, event.target.naturalHeight)) event.target.hidden = true;
      else event.target.parentElement.classList.add('has-image');
    }
    if (event.target.matches('.calendar-day img')) event.target.parentElement.classList.add('has-image');
  }, true);
  const manualDialog = content.querySelector('#manual-dialog');
  const cameraDialog = content.querySelector('#camera-dialog');
  const cropDialog = content.querySelector('#crop-dialog');
  const dayDialog = content.querySelector('#day-dialog');
  const bookDialog = content.querySelector('#book-dialog');
  const reflectionDialog = content.querySelector('#reflection-dialog');
  const finishDialog = content.querySelector('#finish-dialog');
  const plansDialog = content.querySelector('#plans-dialog');
  const today = new Date();
  const todayKey = dayKey(today.getFullYear(), today.getMonth(), today.getDate());
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const reportMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let books = [];
  let completions = [];
  let plans = [];
  let page = 0;
  let selectedDay = todayKey;
  let selectedBook;
  let recordId;
  let bookId;
  let results = [];
  let searchForPlan = false;
  let activeBook;
  let noteRequestId;
  let editingRecord;
  let finishingRecord;
  let reflectionRequestId;
  let returnToDay;
  let manualRecordId;
  let manualBookId;
  let manualSaved;
  let manualPhotos = {};
  let cameraStream;
  let cameraKind;
  let cropCenter = { x: 0.5, y: 0.5 };
  const photoPreviews = {};
  let reminderSettings = loadReminderSettings(localStorage, session.user.id);
  let planReminderSettings = loadPlanReminderSettings(localStorage, session.user.id);
  const reminderMessage = accountDialog.querySelector('#reminder-message');
  const planReminderMessage = accountDialog.querySelector('#plan-reminder-message');
  const withReminderTimeout = promise => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('알림 응답이 지연돼요. 다시 시도해 주세요.')), 10000))]);
  const drawReminders = () => {
    const toggle = accountDialog.querySelector('#reminder-enabled');
    toggle.checked = native && reminderSettings.enabled;
    toggle.disabled = !native;
    const daysInput = accountDialog.querySelector('#reminder-days');
    daysInput.value = reminderSettings.days;
    daysInput.disabled = !native;
    const reading = completions.filter(record => !record.completed_on).length;
    const count = accountDialog.querySelector('#reminder-count');
    count.textContent = native ? (reading ? `현재 읽는 중인 책 ${reading}권 · 완독하면 알림은 자동으로 취소돼요.` : '읽는 중인 책이 생기면 알림을 예약할게요.') : '알림은 iOS 앱에서 설정할 수 있어요.';
    if (native && reminderSettings.enabled && reading) withReminderTimeout(readingReminderStatus(session.user.id)).then(({ permission, next }) => {
      count.textContent += permission !== 'granted' ? ' 기기 알림 권한이 꺼져 있어요.' : next ? ` 다음 알림: ${new Date(next).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ' 예약된 알림이 없어요. 알림 시점을 다시 저장해 주세요.';
    }).catch(() => { count.textContent += ' 예약 상태를 확인하지 못했어요.'; });
  };
  const saveReminders = async next => {
    try {
      if (next.enabled) await withReminderTimeout(syncReadingReminders(next, completions, session.user.id));
      else if (reminderSettings.enabled) await withReminderTimeout(clearReadingReminders());
      saveReminderSettings(localStorage, session.user.id, next);
      reminderSettings = next;
      reminderMessage.textContent = '알림 설정을 저장했어요.';
    } catch (error) {
      if (reminderSettings.enabled) await withReminderTimeout(syncReadingReminders(reminderSettings, completions, session.user.id)).catch(() => {});
      reminderMessage.textContent = error.message || '알림을 예약하지 못했어요.';
    }
    drawReminders();
  };
  const drawPlanReminders = () => {
    const toggle = accountDialog.querySelector('#plan-reminder-enabled');
    toggle.checked = native && planReminderSettings.enabled;
    toggle.disabled = !native;
    const daysInput = accountDialog.querySelector('#plan-reminder-days');
    daysInput.value = planReminderSettings.days;
    daysInput.disabled = !native;
    if (!native) planReminderMessage.textContent = '알림은 iOS 앱에서 설정할 수 있어요.';
  };
  const savePlanReminders = async next => {
    try {
      await withReminderTimeout(syncPlannedReminders(next, plans, session.user.id));
      savePlanReminderSettings(localStorage, session.user.id, next);
      planReminderSettings = next;
      planReminderMessage.textContent = '알림 설정을 저장했어요.';
    } catch (error) { planReminderMessage.textContent = error.message || '알림을 예약하지 못했어요.'; }
    drawPlanReminders();
  };
  accountDialog.onchange = async event => {
    if (!native) return;
    if (event.target.id === 'plan-reminder-days') {
      const days = Number(event.target.value);
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        planReminderMessage.textContent = '1일부터 30일 사이의 숫자를 입력해 주세요.';
        drawPlanReminders();
      } else await savePlanReminders({ ...planReminderSettings, days });
      return;
    }
    if (event.target.id === 'plan-reminder-enabled') {
      try {
        if (event.target.checked && !await requestReminderPermission()) throw new Error('기기 설정에서 알림 권한을 허용해 주세요.');
        await savePlanReminders({ ...planReminderSettings, enabled: event.target.checked });
      } catch (error) { planReminderMessage.textContent = error.message || '알림 권한을 확인하지 못했어요.'; drawPlanReminders(); }
      return;
    }
    if (event.target.id === 'reminder-days') {
      const days = Number(event.target.value);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        reminderMessage.textContent = '1일부터 365일 사이의 숫자를 입력해 주세요.';
        drawReminders();
        return;
      }
      await saveReminders({ ...reminderSettings, days, activatedOn: todayKey });
      return;
    }
    if (event.target.id !== 'reminder-enabled') return;
    const enabled = event.target.checked;
    reminderMessage.textContent = enabled ? '알림 권한 확인 중…' : '알림 예약 취소 중…';
    try {
      if (enabled && !await requestReminderPermission()) throw new Error('기기 설정에서 알림 권한을 허용해 주세요.');
      await saveReminders({ ...reminderSettings, enabled, activatedOn: enabled ? todayKey : reminderSettings.activatedOn });
    } catch (error) { reminderMessage.textContent = error.message || '알림 권한을 확인하지 못했어요.'; drawReminders(); }
  };
  drawReminders();
  drawPlanReminders();

  const setTab = tab => {
    content.querySelectorAll('.screen').forEach(screen => { screen.hidden = screen.id !== `${tab}-screen`; });
    content.querySelectorAll('[data-tab]').forEach(button => { button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false'); });
    if (tab === 'calendar') showCalendar();
    if (tab === 'shelf') showBooks();
  };
  content.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => setTab(button.dataset.tab); });

  const showBooks = () => {
    if (!list.clientHeight) return;
    const mobile = matchMedia('(max-width: 520px)').matches;
    const spineWidth = mobile ? 32 : 42;
    const gap = mobile ? 6 : 9;
    const padding = mobile ? 30 : 48;
    const columns = Math.max(1, Math.floor((list.clientWidth - padding + gap) / (spineWidth + gap)));
    const rows = Math.max(1, Math.min(4, Math.floor((list.clientHeight - 28) / 220)));
    const pageSize = columns * rows;
    const shelved = books.filter(book => book.is_shelved);
    const pageCount = Math.max(1, Math.ceil(shelved.length / pageSize));
    page = Math.min(page, pageCount - 1);
    list.style.setProperty('--row-height', `${Math.floor((list.clientHeight - 28) / rows)}px`);
    list.innerHTML = shelved.length ? shelved.slice(page * pageSize, (page + 1) * pageSize).map(book => `<button class="spine" type="button" data-book-id="${book.id}" data-source="${book.source}" aria-label="${escapeHtml(`${book.title}, 메모 열기`)}"><span>${escapeHtml(book.title)}</span><small>${escapeHtml(book.author_text || '')}</small>${yes24ImageURL(book) ? `<img src="${yes24ImageURL(book)}" alt="" loading="lazy">` : ''}</button>`).join('') : '<p class="empty">아직 꽂힌 책이 없어요.<br>달력에서 책을 검색해 기록하면 여기에 꽂혀요.</p>';
    content.querySelector('#page-position').textContent = `${page + 1} / ${pageCount}`;
    content.querySelector('#page-prev').disabled = page === 0;
    content.querySelector('#page-next').disabled = page >= pageCount - 1;
  };
  content.querySelector('#page-prev').onclick = () => { page--; showBooks(); };
  content.querySelector('#page-next').onclick = () => { page++; showBooks(); };
  list.onclick = event => {
    const spine = event.target.closest('[data-book-id]');
    if (spine) openBook(books.find(book => book.id === spine.dataset.bookId));
  };
  shelfObserver = new ResizeObserver(() => requestAnimationFrame(showBooks));
  shelfObserver.observe(list);

  const showCalendar = () => {
    content.querySelector('#month-title').textContent = `${month.getFullYear()}년 ${month.getMonth() + 1}월`;
    const cells = monthCells(month.getFullYear(), month.getMonth());
    const days = cells.map(day => {
      if (!day) return '<span class="calendar-day blank"></span>';
      const key = dayKey(month.getFullYear(), month.getMonth(), day);
      const records = recordsStartedOn(completions, key);
      const title = records[0]?.books?.title;
      const cover = yes24ImageURL(records[0]?.books, 'COVER');
      return `<button class="calendar-day" data-day="${key}" aria-label="${escapeHtml(`${day}일${title ? `, ${title}` : ''}${records.length > 1 ? ` 외 ${records.length - 1}권` : ''}`)}" ${key > todayKey ? 'disabled' : ''}>${cover ? `<img src="${cover}" alt="" loading="lazy">` : ''}<b>${day}</b>${title ? `<small>${escapeHtml(title)}</small>` : ''}${records.length > 1 ? `<em class="more-count">+${records.length - 1}</em>` : ''}</button>`;
    }).join('');
    content.querySelector('#calendar-grid').innerHTML = ['일','월','화','수','목','금','토'].map(day => `<strong class="weekday">${day}</strong>`).join('') + days;
    content.querySelector('#calendar-message').textContent = '날짜를 누르면 그날의 기록을 볼 수 있어요.';
  };
  content.querySelector('#month-prev').onclick = () => { month.setMonth(month.getMonth() - 1); showCalendar(); };
  content.querySelector('#month-next').onclick = () => { month.setMonth(month.getMonth() + 1); showCalendar(); };

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dayKey(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
  const showPlans = () => {
    content.querySelector('#plans-list').innerHTML = plans.length ? plans.map(plan => `<article class="day-record"><div class="journal-book"><img src="${yes24ImageURL({ source: 'yes24', provider_item_id: plan.provider_item_id }, 'COVER')}" alt="" loading="lazy"><div><h3>${escapeHtml(plan.title)}</h3><p>${escapeHtml(plan.author_text || '')}</p><label>읽을 날짜<input data-plan-date="${plan.id}" type="date" min="${tomorrowKey}" value="${escapeHtml(plan.planned_on)}"></label><div class="plan-actions"><button type="button" data-plan-start="${plan.id}">오늘 읽기 시작</button><button type="button" class="quiet" data-plan-delete="${plan.id}">목록에서 빼기</button></div></div></div></article>`).join('') : '<p>아직 읽기로 한 책이 없어요.</p>';
  };
  content.querySelector('#plans-open').onclick = () => { showPlans(); plansDialog.showModal(); };
  accountDialog.querySelector('#plan-manage').onclick = () => closeAccount(() => { showPlans(); plansDialog.showModal(); });
  content.querySelector('#plans-close').onclick = () => plansDialog.close();
  content.querySelector('#plans-add').onclick = () => { plansDialog.close(); openSearch(tomorrowKey, true); };
  content.querySelector('#plans-list').onchange = async event => {
    const id = event.target.dataset.planDate;
    if (!id) return;
    const message = content.querySelector('#plans-message');
    try {
      if (event.target.value < tomorrowKey) throw new Error('내일 이후 날짜를 선택해 주세요.');
      await changeReadingPlanDate(client, id, event.target.value);
      await loadAll();
      message.textContent = '읽을 날짜를 바꿨어요.';
    } catch (error) { message.textContent = error.message || '날짜를 바꾸지 못했어요.'; showPlans(); }
  };
  content.querySelector('#plans-list').onclick = async event => {
    const button = event.target.closest('[data-plan-start], [data-plan-delete]');
    if (!button) return;
    const id = button.dataset.planStart || button.dataset.planDelete;
    const plan = plans.find(item => item.id === id);
    if (!plan) return;
    button.disabled = true;
    const message = content.querySelector('#plans-message');
    message.textContent = '처리 중…';
    try {
      if (button.dataset.planStart) await startReading(client, { id: plan.provider_item_id, isbn: plan.isbn, title: plan.title, authorText: plan.author_text }, todayKey, crypto.randomUUID(), crypto.randomUUID());
      await removeReadingPlan(client, id);
      await loadAll();
      showPlans();
      message.textContent = button.dataset.planStart ? '읽기 시작을 기록했어요.' : '목록에서 뺐어요.';
      if (button.dataset.planStart) { plansDialog.close(); setTab('calendar'); openDay(todayKey); }
    } catch (error) { message.textContent = error.message || '저장하지 못했어요. 다시 시도해 주세요.'; button.disabled = false; }
  };

  const openDay = day => {
    selectedDay = day;
    content.querySelector('#day-title').textContent = `${day.replaceAll('-', '. ')}. 독서 기록`;
    const records = recordsStartedOn(completions, day);
    content.querySelector('#day-records').innerHTML = records.length ? records.map(record => `<article class="day-record"><div class="journal-book">${yes24ImageURL(record.books, 'COVER') ? `<img src="${yes24ImageURL(record.books, 'COVER')}" alt="" loading="lazy">` : ''}<div><h3>${escapeHtml(record.books?.title || '제목 없음')}</h3><p>${record.completed_on ? `${escapeHtml(record.completed_on)} 완독 · ${escapeHtml(record.reflection || '아직 소감을 적지 않았어요.')}` : `${escapeHtml(record.started_on)} 읽기 시작 · 아직 완독하지 않았어요.`}</p>${record.completed_on ? `<button class="quiet" type="button" data-edit-record="${record.id}">소감 쓰기·수정</button>` : `<button class="quiet" type="button" data-finish-record="${record.id}">완독했어요</button>`}</div></div></article>`).join('') : '<p>아직 이 날짜에 남긴 기록이 없어요.</p>';
    dayDialog.showModal();
    content.querySelector('#day-records').scrollTop = 0;
  };
  content.querySelector('#day-close').onclick = () => dayDialog.close();
  content.querySelector('#day-add').onclick = () => { dayDialog.close(); openSearch(selectedDay); };
  content.querySelector('#day-records').onclick = event => {
    const button = event.target.closest('[data-finish-record]');
    if (!button) return;
    finishingRecord = completions.find(record => record.id === button.dataset.finishRecord);
    if (!finishingRecord) return;
    dayDialog.close();
    content.querySelector('#finish-book').textContent = finishingRecord.books?.title || '제목 없음';
    const date = content.querySelector('#finish-form [name="completed_on"]');
    date.min = finishingRecord.started_on;
    date.max = todayKey;
    date.value = todayKey;
    content.querySelector('#finish-message').textContent = '';
    finishDialog.showModal();
  };
  content.querySelector('#finish-close').onclick = () => finishDialog.close();
  content.querySelector('#finish-form').onsubmit = async event => {
    event.preventDefault();
    const completedOn = new FormData(event.target).get('completed_on');
    const button = content.querySelector('#finish-save');
    const message = content.querySelector('#finish-message');
    button.disabled = true;
    message.textContent = '저장 중…';
    try {
      await finishReading(client, finishingRecord.id, completedOn);
      finishDialog.close();
      await loadAll();
      setTab('calendar');
      openDay(finishingRecord.started_on);
    } catch (error) { message.textContent = error.message || '완독일을 저장하지 못했어요.'; }
    finally { button.disabled = false; }
  };

  const draftKey = book => `reading-journal:shelf-note:${session.user.id}:${book.id}`;
  const openBook = book => {
    if (!book) return;
    activeBook = book;
    noteRequestId = undefined;
    content.querySelector('#book-title').textContent = book.title;
    content.querySelector('#book-cover-title').textContent = book.title;
    const image = content.querySelector('#book-cover-image');
    const imageURL = yes24ImageURL(book, 'COVER');
    image.hidden = !imageURL;
    if (imageURL) image.src = imageURL;
    const draft = localStorage.getItem(draftKey(book));
    const readOnly = !!book.shelf_note?.trim() && draft === null;
    content.querySelector('#book-note').value = draft ?? book.shelf_note ?? '';
    content.querySelector('#book-note-view').textContent = book.shelf_note || '';
    content.querySelector('#book-note-view').hidden = !readOnly;
    content.querySelector('#book-edit').hidden = !readOnly;
    content.querySelector('#book-note-form').hidden = readOnly;
    content.querySelector('#book-message').textContent = '';
    content.querySelector('#book-server-note').hidden = true;
    content.querySelector('#book-save').textContent = '저장';
    content.querySelector('#book-stage').className = 'book-stage';
    bookDialog.showModal();
    setTimeout(() => {
      if (!bookDialog.open) return;
      content.querySelector('#book-stage').classList.add('opened');
      setTimeout(() => {
        if (bookDialog.open && !content.querySelector('#book-note-form').hidden) content.querySelector('#book-note').focus();
      }, 1050);
    }, 350);
  };
  content.querySelector('#book-close').onclick = () => bookDialog.close();
  content.querySelector('#book-edit').onclick = () => {
    content.querySelector('#book-note-view').hidden = true;
    content.querySelector('#book-edit').hidden = true;
    content.querySelector('#book-note-form').hidden = false;
    content.querySelector('#book-note').focus();
  };
  content.querySelector('#book-note').oninput = event => {
    try { localStorage.setItem(draftKey(activeBook), event.target.value); }
    catch { content.querySelector('#book-message').textContent = '이 기기에 초안을 보관하지 못했어요. 저장 전 앱을 닫지 마세요.'; }
  };
  content.querySelector('#book-note-form').onsubmit = async event => {
    event.preventDefault();
    const note = content.querySelector('#book-note').value;
    const message = content.querySelector('#book-message');
    const button = content.querySelector('#book-save');
    noteRequestId ||= crypto.randomUUID();
    button.disabled = true;
    message.textContent = '저장 중…';
    try {
      const result = await saveShelfNote(client, activeBook, note, noteRequestId);
      activeBook.version = result.version;
      activeBook.shelf_note = result.content;
      if (result.status === 'conflict') {
        noteRequestId = undefined;
        message.textContent = '다른 기기에서 먼저 수정했어요. 내 초안은 보존됐습니다. 비교한 뒤 다시 저장할 수 있어요.';
        const serverNote = content.querySelector('#book-server-note');
        serverNote.textContent = `서버 메모: ${result.content || '(비어 있음)'}`;
        serverNote.hidden = false;
        button.textContent = '내 초안 다시 저장';
      } else {
        localStorage.removeItem(draftKey(activeBook));
        const stage = content.querySelector('#book-stage');
        stage.classList.add('closing');
        stage.classList.remove('opened');
        setTimeout(() => bookDialog.close(), 1100);
      }
    } catch (error) { message.textContent = error.message || '저장하지 못했어요. 초안은 이 기기에 남아 있어요.'; }
    finally { button.disabled = false; }
  };

  const showJournal = () => {
    const { started, finished } = monthReport(completions, reportMonth.getFullYear(), reportMonth.getMonth());
    content.querySelector('#report-title').textContent = `${reportMonth.getFullYear()}년 ${reportMonth.getMonth() + 1}월`;
    content.querySelector('#report-started').textContent = started;
    content.querySelector('#report-finished').textContent = finished.length;
    content.querySelector('#journal-feed').innerHTML = finished.length ? finished.map(record => `<article class="journal-card"><small>${escapeHtml(record.completed_on)} 완독 · ${escapeHtml(record.started_on)} 읽기 시작</small><div class="journal-book">${yes24ImageURL(record.books, 'COVER') ? `<img src="${yes24ImageURL(record.books, 'COVER')}" alt="" loading="lazy">` : ''}<h2>${escapeHtml(record.books?.title || '제목 없음')}</h2></div><p>${escapeHtml(record.reflection || '아직 소감을 적지 않았어요.')}</p><button class="quiet" type="button" data-edit-record="${record.id}">${record.reflection ? '소감 수정' : '소감 남기기'}</button></article>`).join('') : '<div class="journal-empty"><p>이번 달에 완독한 책이 없어요.</p><button id="journal-to-calendar">달력에서 기록하기</button></div>';
  };
  content.querySelector('#report-prev').onclick = () => { reportMonth.setMonth(reportMonth.getMonth() - 1); showJournal(); };
  content.querySelector('#report-next').onclick = () => { reportMonth.setMonth(reportMonth.getMonth() + 1); showJournal(); };
  const reportMonthDialog = content.querySelector('#report-month-dialog');
  const reportMonthForm = content.querySelector('#report-month-form');
  content.querySelector('#report-title').onclick = () => {
    reportMonthForm.elements.year.value = reportMonth.getFullYear();
    reportMonthForm.elements.month.value = reportMonth.getMonth() + 1;
    reportMonthDialog.showModal();
  };
  content.querySelector('#report-month-close').onclick = () => reportMonthDialog.close();
  reportMonthForm.onsubmit = event => {
    event.preventDefault();
    reportMonth.setFullYear(Number(reportMonthForm.elements.year.value), Number(reportMonthForm.elements.month.value) - 1, 1);
    reportMonthDialog.close();
    showJournal();
  };
  content.querySelector('#journal-feed').onclick = event => {
    if (event.target.closest('#journal-to-calendar')) setTab('calendar');
  };
  const reflectionDraftKey = record => `reading-journal:reflection:${session.user.id}:${record.id}`;
  content.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-record]');
    if (!button) return;
    editingRecord = completions.find(record => record.id === button.dataset.editRecord);
    if (!editingRecord) return;
    reflectionRequestId = undefined;
    returnToDay = dayDialog.open ? selectedDay : null;
    if (dayDialog.open) dayDialog.close();
    content.querySelector('#reflection-book').textContent = editingRecord.books?.title || '제목 없음';
    const draft = localStorage.getItem(reflectionDraftKey(editingRecord));
    content.querySelector('#reflection-text').value = draft ?? editingRecord.reflection ?? '';
    content.querySelector('#reflection-message').textContent = draft === null ? '' : '이 기기에 남은 초안을 불러왔어요.';
    content.querySelector('#reflection-server').hidden = true;
    content.querySelector('#reflection-save').textContent = '저장';
    reflectionDialog.showModal();
  });
  content.querySelector('#reflection-close').onclick = () => reflectionDialog.close();
  reflectionDialog.onclose = () => {
    if (returnToDay) openDay(returnToDay);
    returnToDay = null;
  };
  content.querySelector('#reflection-text').oninput = event => {
    try { localStorage.setItem(reflectionDraftKey(editingRecord), event.target.value); }
    catch { content.querySelector('#reflection-message').textContent = '초안을 기기에 보관하지 못했어요. 저장 전 앱을 닫지 마세요.'; }
  };
  content.querySelector('#reflection-form').onsubmit = async event => {
    event.preventDefault();
    const text = content.querySelector('#reflection-text').value;
    const message = content.querySelector('#reflection-message');
    const button = content.querySelector('#reflection-save');
    try { localStorage.setItem(reflectionDraftKey(editingRecord), text); }
    catch { message.textContent = '초안을 기기에 보관하지 못했어요. 저장 전 앱을 닫지 마세요.'; }
    reflectionRequestId ||= crypto.randomUUID();
    button.disabled = true;
    message.textContent = '저장 중…';
    try {
      const result = await saveReflection(client, editingRecord, text, reflectionRequestId);
      if (result.status === 'conflict') {
        editingRecord.version = result.version;
        editingRecord.reflection = result.content;
        showJournal();
        reflectionRequestId = undefined;
        content.querySelector('#reflection-server').textContent = `다른 기기에서 저장한 글:\n${result.content || '(비어 있음)'}`;
        content.querySelector('#reflection-server').hidden = false;
        message.textContent = '다른 기기에서 먼저 수정했어요. 두 글을 확인한 뒤 내 글로 덮어쓸 수 있어요. 초안은 보존됐습니다.';
        button.textContent = '내 글로 덮어쓰기';
      } else {
        editingRecord.version = result.version;
        editingRecord.reflection = result.content;
        localStorage.removeItem(reflectionDraftKey(editingRecord));
        await loadAll();
        showJournal();
        reflectionDialog.close();
      }
    } catch (error) { message.textContent = error.message || '저장하지 못했어요. 초안은 이 기기에 남아 있어요.'; }
    finally { button.disabled = false; }
  };
  const loadAll = async () => {
    const [shelf, journal, planned] = await Promise.all([
      client.from('books').select(BOOK_COLUMNS).order('created_at', { ascending: false }),
      client.from('completions').select('id,book_id,started_on,completed_on,created_at,reflection,version,books(title,author_text,source,provider_item_id,cover_path,spine_path)').order('started_on', { ascending: false }).order('created_at', { ascending: true }).order('id', { ascending: true }),
      client.from('reading_plans').select('id,provider_item_id,isbn,title,author_text,planned_on').order('planned_on', { ascending: true }),
    ]);
    if (shelf.error) list.innerHTML = `<p class="empty">서가를 불러오지 못했어요.</p>`;
    else { books = await attachBookPhotos(client, shelf.data); showBooks(); }
    if (journal.error) content.querySelector('#calendar-message').textContent = '독서 기록을 불러오지 못했어요.';
    else {
      const joined = await attachBookPhotos(client, journal.data.map(record => record.books || {}));
      completions = journal.data.map((record, index) => ({ ...record, books: joined[index] || record.books }));
      showCalendar(); showJournal();
      if (native && reminderSettings.enabled) await withReminderTimeout(syncReadingReminders(reminderSettings, completions, session.user.id)).catch(error => { reminderMessage.textContent = error.message || '알림 상태를 확인하지 못했어요.'; });
      drawReminders();
    }
    if (planned.error) content.querySelector('#plans-message').textContent = '읽을 책을 불러오지 못했어요.';
    else {
      plans = planned.data;
      if (plansDialog.open) showPlans();
      if (native && planReminderSettings.enabled) await withReminderTimeout(syncPlannedReminders(planReminderSettings, plans, session.user.id)).catch(error => { planReminderMessage.textContent = error.message || '읽을 책 알림을 확인하지 못했어요.'; });
    }
  };

  const openSearch = (day, planned = false) => {
    searchForPlan = planned;
    selectedDay = day;
    selectedBook = undefined;
    results = [];
    recordId = undefined;
    bookId = undefined;
    content.querySelector('#search-day').textContent = planned ? '읽을 책과 날짜를 정해 주세요.' : `${day} 읽기 시작`;
    content.querySelector('#search-results').textContent = '';
    content.querySelector('#search-results').hidden = false;
    content.querySelector('#manual-open').hidden = planned;
    content.querySelector('#search-form').reset();
    content.querySelector('#completion-form').hidden = true;
    content.querySelector('#completion-form [name="started_on"]').value = day;
    content.querySelector('#reading-date-label').textContent = planned ? '읽을 날짜' : '시작일';
    content.querySelector('#completion-save').textContent = planned ? '읽을 책에 담기' : '읽기 시작';
    content.querySelector('#completion-form [name="started_on"]').min = planned ? tomorrowKey : '';
    content.querySelector('#completion-form [name="started_on"]').max = planned ? '' : todayKey;
    dialog.showModal();
    content.querySelector('#search-form input').focus();
  };
  content.querySelector('#add-completion').onclick = () => openSearch(todayKey);
  content.querySelector('#calendar-grid').onclick = event => {
    const day = event.target.closest('[data-day]');
    if (day && !day.disabled) openDay(day.dataset.day);
  };
  content.querySelector('#search-close').onclick = () => dialog.close();
  content.querySelector('#manual-open').onclick = () => {
    dialog.close();
    manualRecordId = crypto.randomUUID();
    manualBookId = crypto.randomUUID();
    manualSaved = undefined;
    manualPhotos = {};
    content.querySelector('#manual-form').reset();
    content.querySelectorAll('#manual-form input[name]').forEach(input => { input.disabled = false; });
    content.querySelector('#manual-form [name="started_on"]').value = selectedDay;
    content.querySelector('#manual-form [name="started_on"]').max = todayKey;
    content.querySelector('#manual-form [name="title"]').value = content.querySelector('#search-form [name="query"]').value.trim();
    content.querySelector('#manual-message').textContent = '';
    for (const kind of ['cover', 'spine']) content.querySelector(`#manual-${kind}-preview`).hidden = true;
    manualDialog.showModal();
  };
  content.querySelector('#manual-close').onclick = () => manualDialog.close();
  manualDialog.onclose = () => {
    for (const url of Object.values(photoPreviews)) URL.revokeObjectURL(url);
    for (const kind of ['cover', 'spine']) delete photoPreviews[kind];
  };
  const setManualPhoto = async (kind, file) => {
    const blob = await photoBlob(file);
    manualPhotos[kind] = blob;
    if (photoPreviews[kind]) URL.revokeObjectURL(photoPreviews[kind]);
    photoPreviews[kind] = URL.createObjectURL(blob);
    const preview = content.querySelector(`#manual-${kind}-preview`);
    preview.src = photoPreviews[kind];
    preview.hidden = false;
  };
  const stopCamera = () => { cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = undefined; };
  cameraDialog.onclose = stopCamera;
  content.querySelector('#camera-close').onclick = () => cameraDialog.close();
  manualDialog.querySelectorAll('[data-camera]').forEach(button => button.onclick = async () => {
    cameraKind = button.dataset.camera;
    content.querySelector('#camera-title').textContent = cameraKind === 'cover' ? '표지 촬영' : '책등 촬영';
    content.querySelector('#camera-guide').classList.toggle('spine-guide', cameraKind === 'spine');
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      content.querySelector('#camera-video').srcObject = cameraStream;
      cameraDialog.showModal();
    } catch { content.querySelector('#manual-message').textContent = '카메라를 열지 못했어요. 기기 설정에서 카메라 권한을 허용해 주세요.'; }
  });
  const cropCanvas = content.querySelector('#crop-canvas');
  const cropSize = content.querySelector('#crop-size');
  const currentCrop = () => cropRect(cropCanvas.width, cropCanvas.height, cameraKind === 'cover' ? 2 / 3 : 1 / 5, Number(cropSize.value) / 100, cropCenter.x, cropCenter.y);
  const showCropGuide = () => {
    const { x, y, width, height } = currentCrop();
    const guide = content.querySelector('#crop-guide');
    guide.style.left = `${x / cropCanvas.width * 100}%`;
    guide.style.top = `${y / cropCanvas.height * 100}%`;
    guide.style.width = `${width / cropCanvas.width * 100}%`;
    guide.style.height = `${height / cropCanvas.height * 100}%`;
  };
  content.querySelector('#camera-shoot').onclick = () => {
    const video = content.querySelector('#camera-video');
    if (!video.videoWidth) return;
    const frame = video.getBoundingClientRect();
    const visible = visibleVideoRect(video.videoWidth, video.videoHeight, frame.width, frame.height);
    cropCanvas.width = Math.min(1200, Math.round(visible.width));
    cropCanvas.height = Math.round(cropCanvas.width * frame.height / frame.width);
    cropCanvas.getContext('2d').drawImage(video, visible.x, visible.y, visible.width, visible.height, 0, 0, cropCanvas.width, cropCanvas.height);
    cropCenter = { x: 0.5, y: 0.5 };
    const guideWidth = content.querySelector('#camera-guide').getBoundingClientRect().width;
    const ratio = cameraKind === 'cover' ? 2 / 3 : 1 / 5;
    cropSize.value = String(Math.round(guideWidth / Math.min(frame.width, frame.height * ratio) * 100));
    content.querySelector('#crop-message').textContent = '';
    showCropGuide();
    cameraDialog.close();
    cropDialog.showModal();
  };
  cropSize.oninput = showCropGuide;
  cropCanvas.onpointerdown = event => {
    cropCanvas.setPointerCapture(event.pointerId);
    cropCanvas.onpointermove(event);
  };
  cropCanvas.onpointermove = event => {
    if (!cropCanvas.hasPointerCapture(event.pointerId)) return;
    const bounds = cropCanvas.getBoundingClientRect();
    cropCenter = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
    showCropGuide();
  };
  content.querySelector('#crop-close').onclick = () => cropDialog.close();
  content.querySelector('#crop-retake').onclick = () => {
    cropDialog.close();
    manualDialog.querySelector(`[data-camera="${cameraKind}"]`).click();
  };
  content.querySelector('#crop-save').onclick = async () => {
    const rect = currentCrop();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    canvas.getContext('2d').drawImage(cropCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      await setManualPhoto(cameraKind, blob);
      cropDialog.close();
    } catch (error) { content.querySelector('#crop-message').textContent = error.message || '사진을 저장하지 못했어요.'; }
  };
  content.querySelector('#manual-form').onsubmit = async event => {
    event.preventDefault();
    const fields = new FormData(event.target);
    const button = content.querySelector('#manual-save');
    const message = content.querySelector('#manual-message');
    button.disabled = true;
    message.textContent = '저장 중…';
    try {
      const saved = manualSaved || await startManualReading(client, { bookId: manualBookId, title: fields.get('title'), author: fields.get('author'), isbn: fields.get('isbn') }, fields.get('started_on'), manualRecordId);
      manualSaved = saved;
      content.querySelectorAll('#manual-form input[name]').forEach(input => { input.disabled = true; });
      manualBookId = saved.book_id;
      for (const [kind, blob] of Object.entries(manualPhotos)) {
        await uploadBookPhoto(client, session.user.id, manualBookId, kind, blob);
        delete manualPhotos[kind];
      }
      manualDialog.close();
      page = 0;
      await loadAll();
      setTab('calendar');
      openDay(saved.started_on);
    } catch (error) { message.textContent = `${error.message || '저장하지 못했어요.'} 기록이나 사진이 일부 저장됐을 수 있어요. 이 화면에서 다시 저장하면 이어집니다.`; }
    finally { button.disabled = false; }
  };
  content.querySelector('#search-form').onsubmit = async event => {
    event.preventDefault();
    const resultsView = content.querySelector('#search-results');
    resultsView.hidden = false;
    content.querySelector('#completion-form').hidden = true;
    resultsView.textContent = '책을 찾는 중…';
    try {
      if (!searchURL) throw new Error('책 검색 주소가 설정되지 않았어요.');
      results = await searchYes24(searchURL, new FormData(event.target).get('query'));
      resultsView.innerHTML = results.length ? results.map((book, index) => `<button class="search-result" data-index="${index}" type="button">${safeImage(book.coverURL) ? `<img src="${escapeHtml(book.coverURL)}" alt="">` : ''}<span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.authorText || '')}</small></span></button>`).join('') : '<p>검색 결과가 없어요.</p>';
    } catch (error) { resultsView.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
  };
  content.querySelector('#search-results').onclick = event => {
    const item = event.target.closest('[data-index]');
    if (!item) return;
    selectedBook = results[Number(item.dataset.index)];
    recordId = crypto.randomUUID();
    bookId = crypto.randomUUID();
    content.querySelector('#selected-title').textContent = selectedBook.title;
    content.querySelector('#search-results').hidden = true;
    content.querySelector('#completion-form').hidden = false;
    content.querySelector('#completion-form').scrollIntoView({ block: 'nearest' });
  };
  content.querySelector('#completion-form').onsubmit = async event => {
    event.preventDefault();
    if (!selectedBook) return;
    const form = event.target;
    const fields = new FormData(form);
    const button = content.querySelector('#completion-save');
    const message = content.querySelector('#completion-message');
    button.disabled = true;
    message.textContent = '저장 중…';
    try {
      if (searchForPlan) {
        if (fields.get('started_on') < tomorrowKey) throw new Error('내일 이후 날짜를 선택해 주세요.');
        await addReadingPlan(client, session.user.id, selectedBook, fields.get('started_on'), crypto.randomUUID());
        dialog.close();
        await loadAll();
        showPlans();
        plansDialog.showModal();
        content.querySelector('#plans-message').textContent = '읽을 책에 담았어요.';
        return;
      }
      const saved = await startReading(client, selectedBook, fields.get('started_on'), recordId, bookId);
      dialog.close();
      page = 0;
      await loadAll();
      setTab('calendar');
      openDay(saved.started_on);
    } catch (error) { message.textContent = error.message || '저장하지 못했어요. 다시 시도해 주세요.'; }
    finally { button.disabled = false; }
  };
  await loadAll();
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function safeImage(value) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname.endsWith('.yes24.com'); } catch { return false; } }

async function startBanner() {
  if (banner) return;
  const slot = root.querySelector('.ad-slot');
  if (slot) slot.textContent = '광고 동의 확인 중…';
  try {
    const { AdMob, AdmobConsentStatus, BannerAdPluginEvents, BannerAdPosition, BannerAdSize } = await import('@capacitor-community/admob');
    let consent = await AdMob.requestConsentInfo();
    if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) consent = await AdMob.showConsentForm();
    if (consent.privacyOptionsRequirementStatus === 'REQUIRED') {
      root.querySelector('#logout')?.insertAdjacentHTML('beforebegin', '<button id="ad-privacy" class="quiet" type="button">광고 개인정보</button>');
      root.querySelector('#ad-privacy').onclick = () => AdMob.showPrivacyOptionsForm();
    }
    if (!consent.canRequestAds || !root.querySelector('.ad-slot')) {
      slot?.remove();
      return;
    }
    if (slot) slot.textContent = '';
    await AdMob.addListener(BannerAdPluginEvents.SizeChanged, ({ height }) => {
      const slot = root.querySelector('.ad-slot');
      if (slot && height > 0) {
        slot.style.height = `${height}px`;
        root.style.setProperty('--ad-banner-height', `${height}px`);
      }
    });
    await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
      const slot = root.querySelector('.ad-slot');
      if (slot) slot.textContent = '';
    });
    await AdMob.initialize();
    if (!root.querySelector('.ad-slot')) return;
    const adId = import.meta.env.MODE === 'ios-dev'
      ? 'ca-app-pub-3940256099942544/2435281174'
      : 'ca-app-pub-6828399849556449/5627693129';
    await AdMob.showBanner({ adId, adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER, margin: 0, npa: true });
    banner = AdMob;
  } catch (error) {
    slot?.remove();
    console.error('광고를 불러오지 못했어요.', error);
  }
}

async function stopBanner() {
  if (!banner) return;
  try { await banner.removeBanner(); }
  catch (error) { console.error('광고를 닫지 못했어요.', error); }
  banner = undefined;
}
