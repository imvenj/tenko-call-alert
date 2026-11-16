(() => {
  const TARGET_HASH = "#/call-manage/call-condition";
  const TABLE_ROW_SELECTOR =
    "table.el-table__body > tbody > tr.el-table__row";
  const CONFIRM_BUTTON_TEXT = "確認";
  const ROUTE_CHANGE_EVENT = "tenko-spa-route-change";
  const DEFAULT_CONTINUOUS_ALERT_INTERVAL = 15;
  const MIN_CONTINUOUS_ALERT_INTERVAL = 5;

  let observer = null;
  let repeatAlertTimer = null;
  let repeatAlertGeneration = 0;
  let hadConfirmButton = false;
  let initializedForCurrentVisit = false;
  let routeUpdateScheduled = false;

  function log(...args) {
    console.log("[Tenko 点呼アラート]", ...args);
  }

  function isTargetPage() {
    return location.hash === TARGET_HASH;
  }

  function getConfirmButtonRowCount() {
    const rows = document.querySelectorAll(TABLE_ROW_SELECTOR);

    return Array.from(rows).filter((row) =>
      Array.from(row.querySelectorAll("button.el-button")).some(
        (button) =>
          (button.textContent || "").trim() === CONFIRM_BUTTON_TEXT
      )
    ).length;
  }

  async function isEnabled() {
    if (!chrome.runtime?.id) return false;

    try {
      const result = await chrome.storage.local.get({ enabled: true });
      return result.enabled;
    } catch (error) {
      // 拡張機能の再読み込みで古いコンテンツスクリプトが無効になった場合。
      return false;
    }
  }

  function normalizeContinuousAlertInterval(value) {
    const interval = Number.parseInt(value, 10);
    if (!Number.isInteger(interval)) return DEFAULT_CONTINUOUS_ALERT_INTERVAL;
    return Math.max(interval, MIN_CONTINUOUS_ALERT_INTERVAL);
  }

  function clearRepeatAlertTimer() {
    repeatAlertGeneration += 1;
    if (repeatAlertTimer !== null) {
      clearTimeout(repeatAlertTimer);
      repeatAlertTimer = null;
    }
  }

  function speakAlert() {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ type: "SPEAK_ALERT" }).catch(() => {});
  }

  async function scheduleRepeatAlert() {
    clearRepeatAlertTimer();
    const generation = repeatAlertGeneration;

    if (!chrome.runtime?.id || !isTargetPage() || !hadConfirmButton) return;

    try {
      const settings = await chrome.storage.local.get({
        enabled: true,
        continuousAlertEnabled: true,
        continuousAlertInterval: DEFAULT_CONTINUOUS_ALERT_INTERVAL
      });
      if (
        generation !== repeatAlertGeneration ||
        !settings.enabled ||
        !settings.continuousAlertEnabled ||
        !isTargetPage() ||
        !hadConfirmButton
      ) {
        return;
      }

      const interval = normalizeContinuousAlertInterval(
        settings.continuousAlertInterval
      );
      repeatAlertTimer = setTimeout(async () => {
        repeatAlertTimer = null;
        const hasConfirmButton = getConfirmButtonRowCount() > 0;
        hadConfirmButton = hasConfirmButton;
        if (!hasConfirmButton || !isTargetPage()) {
          clearRepeatAlertTimer();
          return;
        }

        try {
          const latestSettings = await chrome.storage.local.get({
            enabled: true,
            continuousAlertEnabled: true
          });
          if (
            generation !== repeatAlertGeneration ||
            !latestSettings.enabled ||
            !latestSettings.continuousAlertEnabled ||
            !isTargetPage() ||
            getConfirmButtonRowCount() === 0
          ) {
            return;
          }

          speakAlert();
          scheduleRepeatAlert().catch(() => {});
        } catch (_error) {
          clearRepeatAlertTimer();
        }
      }, interval * 1000);
    } catch (_error) {
      clearRepeatAlertTimer();
    }
  }

  function updateRouteBadge() {
    if (!chrome.runtime?.id) return;

    chrome.runtime
      .sendMessage({
        type: "ROUTE_STATUS",
        isTargetPage: isTargetPage()
      })
      .catch(() => {});
  }

  function removeRouteBadge() {
    if (!chrome.runtime?.id) return;

    chrome.runtime
      .sendMessage({ type: "REMOVE_ROUTE_STATUS" })
      .catch(() => {});
  }

  async function checkTable() {
    if (!isTargetPage()) return;

    const confirmButtonRowCount = getConfirmButtonRowCount();
    const hasConfirmButton = confirmButtonRowCount > 0;

    // 初回表示時は状態のみを記録し、既存の「確認」ボタンによる誤通知を防ぐ。
    if (!initializedForCurrentVisit) {
      initializedForCurrentVisit = true;
      hadConfirmButton = hasConfirmButton;
      log(
        `監視を開始しました。「確認」ボタンのある行は ${confirmButtonRowCount} 件です。`
      );
      return;
    }

    // いずれかの行に「確認」ボタンが現れた瞬間のみ通知する。
    const shouldNotify = !hadConfirmButton && hasConfirmButton;
    hadConfirmButton = hasConfirmButton;

    if (!hasConfirmButton) {
      clearRepeatAlertTimer();
    }

    if (shouldNotify && (await isEnabled())) {
      log(
        `「確認」ボタンのある行を ${confirmButtonRowCount} 件検出したため、音声通知を再生します。`
      );
      speakAlert();
      scheduleRepeatAlert().catch(() => {});
    }
  }

  function stopObserver() {
    clearRepeatAlertTimer();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function startObserver() {
    stopObserver();
    initializedForCurrentVisit = false;
    hadConfirmButton = false;
    updateRouteBadge();

    if (!isTargetPage()) {
      log("対象ページではないため、監視を停止します。");
      return;
    }

    observer = new MutationObserver(() => {
      checkTable().catch(() => {});
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    checkTable().catch(() => {});
  }

  function scheduleObserverUpdate() {
    if (routeUpdateScheduled) return;
    routeUpdateScheduled = true;

    queueMicrotask(() => {
      routeUpdateScheduled = false;
      startObserver();
    });
  }

  window.addEventListener("hashchange", scheduleObserverUpdate);
  window.addEventListener("popstate", scheduleObserverUpdate);
  document.addEventListener(ROUTE_CHANGE_EVENT, scheduleObserverUpdate);
  window.addEventListener("pagehide", removeRouteBadge);
  window.addEventListener("pageshow", scheduleObserverUpdate);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName !== "local" ||
      (!changes.enabled &&
        !changes.continuousAlertEnabled &&
        !changes.continuousAlertInterval)
    ) {
      return;
    }

    if (hadConfirmButton && isTargetPage()) {
      scheduleRepeatAlert().catch(() => {});
    } else {
      clearRepeatAlertTimer();
    }
  });
  startObserver();
})();
