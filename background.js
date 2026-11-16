const ALERT_TEXT = "点呼があります。速やかに対応してください。";
const PAGE_REMINDER_ALARM = "tenkoPageReminder";
const PAGE_REMINDER_NOTIFICATION = "tenkoPageReminderNotification";
const TARGET_HASH = "#/call-manage/call-condition";
const BASE_URL = "https://www.TENKO_SERVICE.com";
const PC_URL_PATTERN = `${BASE_URL}/pc/*`;
const TARGET_URL = `${BASE_URL}/pc/${TARGET_HASH}`;
const DEFAULT_PAGE_REMINDER_INTERVAL = 3;
const MIN_PAGE_REMINDER_INTERVAL = 1;
const MAX_PAGE_REMINDER_INTERVAL = 60;
const DEFAULT_REPEAT_COUNT = 1;
const MAX_REPEAT_COUNT = 5;
const DEFAULT_SPEECH_RATE = 1.0;
const SPEECH_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const ROUTE_STATES_KEY = "tenkoRouteStates";
let routeStateQueue = Promise.resolve();

function normalizeRepeatCount(value) {
  const count = Number.parseInt(value, 10);
  if (!Number.isInteger(count)) return DEFAULT_REPEAT_COUNT;
  return Math.min(Math.max(count, 1), MAX_REPEAT_COUNT);
}

function normalizeSpeechRate(value) {
  const rate = Number.parseFloat(value);
  return SPEECH_RATES.includes(rate) ? rate : DEFAULT_SPEECH_RATE;
}

function normalizePageReminderInterval(value) {
  const interval = Number.parseInt(value, 10);
  if (!Number.isInteger(interval)) return DEFAULT_PAGE_REMINDER_INTERVAL;
  return Math.min(
    Math.max(interval, MIN_PAGE_REMINDER_INTERVAL),
    MAX_PAGE_REMINDER_INTERVAL
  );
}

async function configurePageReminder() {
  const { pageReminderEnabled, pageReminderInterval } =
    await chrome.storage.local.get({
      pageReminderEnabled: false,
      pageReminderInterval: DEFAULT_PAGE_REMINDER_INTERVAL
    });

  await chrome.alarms.clear(PAGE_REMINDER_ALARM);

  if (!pageReminderEnabled) {
    await chrome.notifications.clear(PAGE_REMINDER_NOTIFICATION);
    return;
  }

  const interval = normalizePageReminderInterval(pageReminderInterval);
  await chrome.alarms.create(PAGE_REMINDER_ALARM, {
    delayInMinutes: interval,
    periodInMinutes: interval
  });
}

async function remindIfTargetPageIsClosed() {
  const tabs = await chrome.tabs.query({
    url: PC_URL_PATTERN
  });
  const hasTargetPage = tabs.some((tab) => {
    if (!tab.url) return false;
    try {
      return new URL(tab.url).hash === TARGET_HASH;
    } catch (_error) {
      return false;
    }
  });

  if (hasTargetPage) {
    await chrome.notifications.clear(PAGE_REMINDER_NOTIFICATION);
    return;
  }

  await chrome.notifications.create(PAGE_REMINDER_NOTIFICATION, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Tenko 点呼アラート",
    message: tabs.length > 0
      ? "点呼一覧ページを開いてください。"
      : "Tenkoを開き、点呼一覧ページを表示してください。",
    priority: 2,
    requireInteraction: true
  });
}

async function openTargetPageFromReminder() {
  await chrome.notifications.clear(PAGE_REMINDER_NOTIFICATION);

  const tabs = await chrome.tabs.query({
    url: PC_URL_PATTERN
  });
  const targetTab = tabs.find((tab) => {
    if (!tab.url) return false;
    try {
      return new URL(tab.url).hash === TARGET_HASH;
    } catch (_error) {
      return false;
    }
  });
  const reusableTab = targetTab || tabs[0];

  if (reusableTab?.id != null) {
    const updatedTab = await chrome.tabs.update(reusableTab.id, {
      active: true,
      ...(targetTab ? {} : { url: TARGET_URL })
    });
    if (updatedTab.windowId != null) {
      await chrome.windows.update(updatedTab.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: TARGET_URL, active: true });
}

async function speakAlert() {
  const { repeatCount, speechRate } = await chrome.storage.local.get({
    repeatCount: DEFAULT_REPEAT_COUNT,
    speechRate: DEFAULT_SPEECH_RATE
  });
  const count = normalizeRepeatCount(repeatCount);
  const rate = normalizeSpeechRate(speechRate);

  chrome.tts.stop();

  const options = {
    lang: "ja-JP",
    rate,
    pitch: 1.0,
    volume: 1.0
  };

  for (let index = 0; index < count; index += 1) {
    chrome.tts.speak(ALERT_TEXT, {
      ...options,
      enqueue: index > 0
    });
  }
}

async function updateGlobalRouteBadge(routeStates) {
  const states = Object.values(routeStates);
  const hasTenkoTab = states.length > 0;
  const hasTargetPage = states.some((isTargetPage) => isTargetPage === true);
  const badgeText = hasTargetPage ? "✓" : "!";
  const title = hasTargetPage
    ? "点呼ページを監視中です"
    : hasTenkoTab
      ? "点呼ページを開いてください"
      : "Tenkoを開いてください";

  const updates = [
    chrome.action.setBadgeText({ text: badgeText }),
    chrome.action.setTitle({ title }),
    chrome.action.setBadgeBackgroundColor({
      color: hasTargetPage ? "#188038" : "#d93025"
    }),
    chrome.action.setBadgeTextColor({ color: "#ffffff" })
  ];

  await Promise.all(updates);
}

async function setTabRouteState(tabId, isTargetPage) {
  const stored = await chrome.storage.session.get({
    [ROUTE_STATES_KEY]: {}
  });
  const routeStates = stored[ROUTE_STATES_KEY];
  routeStates[String(tabId)] = isTargetPage;
  await chrome.storage.session.set({ [ROUTE_STATES_KEY]: routeStates });
  await updateGlobalRouteBadge(routeStates);
  if (isTargetPage) {
    await chrome.notifications.clear(PAGE_REMINDER_NOTIFICATION);
  }
}

async function removeTabRouteState(tabId) {
  const stored = await chrome.storage.session.get({
    [ROUTE_STATES_KEY]: {}
  });
  const routeStates = stored[ROUTE_STATES_KEY];
  delete routeStates[String(tabId)];
  await chrome.storage.session.set({ [ROUTE_STATES_KEY]: routeStates });
  await updateGlobalRouteBadge(routeStates);
}

function queueRouteStateUpdate(update) {
  routeStateQueue = routeStateQueue.then(update, update);
}

queueRouteStateUpdate(async () => {
  const stored = await chrome.storage.session.get({
    [ROUTE_STATES_KEY]: {}
  });
  await updateGlobalRouteBadge(stored[ROUTE_STATES_KEY]);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ROUTE_STATUS" && sender.tab?.id != null) {
    queueRouteStateUpdate(() =>
      setTabRouteState(sender.tab.id, message.isTargetPage === true)
    );
    return;
  }

  if (message?.type === "REMOVE_ROUTE_STATUS" && sender.tab?.id != null) {
    queueRouteStateUpdate(() => removeTabRouteState(sender.tab.id));
    return;
  }

  if (message?.type === "SPEAK_ALERT") {
    speakAlert()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueRouteStateUpdate(() => removeTabRouteState(tabId));
});

// ページ遷移が始まった時点で、旧ページの監視状態は無効になる。
// pagehide からのメッセージはページの破棄中に届かないことがあるため、
// バックグラウンド側でも確実に状態を削除する。
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  queueRouteStateUpdate(() => removeTabRouteState(tabId));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== PAGE_REMINDER_ALARM) return;
  remindIfTargetPageIsClosed().catch(() => {});
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== PAGE_REMINDER_NOTIFICATION) return;
  openTargetPageFromReminder().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes.pageReminderEnabled || changes.pageReminderInterval)
  ) {
    configurePageReminder().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  configurePageReminder().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  configurePageReminder().catch(() => {});
});

configurePageReminder().catch(() => {});
