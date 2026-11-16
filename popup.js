const enabled = document.querySelector("#enabled");
const backgroundPollingEnabled = document.querySelector(
  "#background-polling-enabled"
);
const repeatCount = document.querySelector("#repeat-count");
const speechRate = document.querySelector("#speech-rate");
const continuousAlertEnabled = document.querySelector(
  "#continuous-alert-enabled"
);
const continuousAlertIntervalRow = document.querySelector(
  "#continuous-alert-interval-row"
);
const continuousAlertInterval = document.querySelector(
  "#continuous-alert-interval"
);
const pageReminderEnabled = document.querySelector("#page-reminder-enabled");
const pageReminderInterval = document.querySelector("#page-reminder-interval");
const repeatHint = document.querySelector("#repeat-hint");
const testButton = document.querySelector("#test");

function updateRepeatHint(count) {
  repeatHint.textContent = `点呼が入ると、「点呼があります。」と${count}回読み上げます。`;
}

chrome.storage.local.get(
  {
    enabled: true,
    backgroundPollingEnabled: true,
    repeatCount: 1,
    speechRate: 1.0,
    continuousAlertEnabled: true,
    continuousAlertInterval: 15,
    pageReminderEnabled: false,
    pageReminderInterval: 3
  },
  (result) => {
    enabled.checked = result.enabled;
    backgroundPollingEnabled.checked = result.backgroundPollingEnabled;
    const count = Math.min(
      Math.max(Number.parseInt(result.repeatCount, 10) || 1, 1),
      5
    );
    const savedRate = Number.parseFloat(result.speechRate);
    const allowedRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const rate = allowedRates.includes(savedRate) ? savedRate : 1;
    repeatCount.value = String(count);
    speechRate.value = String(rate);
    continuousAlertEnabled.checked = result.continuousAlertEnabled !== false;
    const continuousInterval = Math.max(
      Number.parseInt(result.continuousAlertInterval, 10) || 15,
      5
    );
    continuousAlertInterval.value = String(continuousInterval);
    continuousAlertIntervalRow.hidden = !continuousAlertEnabled.checked;
    pageReminderEnabled.checked = result.pageReminderEnabled === true;
    const reminderInterval = Math.min(
      Math.max(Number.parseInt(result.pageReminderInterval, 10) || 3, 1),
      60
    );
    pageReminderInterval.value = String(reminderInterval);
    pageReminderInterval.disabled = !pageReminderEnabled.checked;
    updateRepeatHint(count);
  }
);

enabled.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabled.checked });
});

backgroundPollingEnabled.addEventListener("change", () => {
  chrome.storage.local.set({
    backgroundPollingEnabled: backgroundPollingEnabled.checked
  });
});

repeatCount.addEventListener("change", () => {
  const count = Number.parseInt(repeatCount.value, 10);
  chrome.storage.local.set({ repeatCount: count });
  updateRepeatHint(count);
});

speechRate.addEventListener("change", () => {
  chrome.storage.local.set({
    speechRate: Number.parseFloat(speechRate.value)
  });
});

continuousAlertEnabled.addEventListener("change", () => {
  continuousAlertIntervalRow.hidden = !continuousAlertEnabled.checked;
  chrome.storage.local.set({
    continuousAlertEnabled: continuousAlertEnabled.checked
  });
});

continuousAlertInterval.addEventListener("change", () => {
  const interval = Math.max(
    Number.parseInt(continuousAlertInterval.value, 10) || 15,
    5
  );
  continuousAlertInterval.value = String(interval);
  chrome.storage.local.set({ continuousAlertInterval: interval });
});

pageReminderEnabled.addEventListener("change", () => {
  pageReminderInterval.disabled = !pageReminderEnabled.checked;
  chrome.storage.local.set({
    pageReminderEnabled: pageReminderEnabled.checked
  });
});

pageReminderInterval.addEventListener("change", () => {
  const interval = Math.min(
    Math.max(Number.parseInt(pageReminderInterval.value, 10) || 3, 1),
    60
  );
  pageReminderInterval.value = String(interval);
  chrome.storage.local.set({ pageReminderInterval: interval });
});

testButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SPEAK_ALERT" });
});
