(() => {
  const SETTING_EVENT = "tenko-background-polling-setting";

  function sendSetting(enabled) {
    document.dispatchEvent(
      new CustomEvent(SETTING_EVENT, { detail: enabled === true })
    );
  }

  chrome.storage.local.get({ backgroundPollingEnabled: true }, (result) => {
    sendSetting(result.backgroundPollingEnabled);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.backgroundPollingEnabled) return;
    sendSetting(changes.backgroundPollingEnabled.newValue);
  });
})();
