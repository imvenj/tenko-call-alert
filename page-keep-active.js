(() => {
  const TARGET_HASH = "#/call-manage/call-condition";
  const LOG_PREFIX = "[Tenko 点呼アラート]";
  const SETTING_EVENT = "tenko-background-polling-setting";
  const ROUTE_CHANGE_EVENT = "tenko-spa-route-change";

  let keepActiveEnabled = true;
  let peerConnection1 = null;
  let peerConnection2 = null;
  let sendingChannel = null;
  let receivingChannel = null;

  function isTargetPage() {
    return location.hash === TARGET_HASH;
  }

  function shouldKeepActive() {
    return keepActiveEnabled && isTargetPage();
  }

  function findNativeGetter(propertyName) {
    let prototype = Object.getPrototypeOf(document);

    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(
        prototype,
        propertyName
      );
      if (descriptor?.get) return descriptor.get;
      prototype = Object.getPrototypeOf(prototype);
    }

    return null;
  }

  function installVisibilityOverrides() {
    const nativeHasFocus = document.hasFocus.bind(document);
    const nativeHiddenGetter = findNativeGetter("hidden");
    const nativeVisibilityStateGetter = findNativeGetter("visibilityState");

    try {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () =>
          shouldKeepActive()
            ? false
            : nativeHiddenGetter?.call(document) ?? false
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () =>
          shouldKeepActive()
            ? "visible"
            : nativeVisibilityStateGetter?.call(document) ?? "visible"
      });
      document.hasFocus = () =>
        shouldKeepActive() ? true : nativeHasFocus();
    } catch (error) {
      console.warn(LOG_PREFIX, "可視状態の上書きに失敗しました。", error);
    }

    window.addEventListener(
      "blur",
      (event) => {
        if (shouldKeepActive() && event.target === window) {
          event.stopImmediatePropagation();
        }
      },
      true
    );
  }

  function closePeerConnections() {
    sendingChannel?.close();
    receivingChannel?.close();
    peerConnection1?.close();
    peerConnection2?.close();

    sendingChannel = null;
    receivingChannel = null;
    peerConnection1 = null;
    peerConnection2 = null;
  }

  function waitForIceGathering(peerConnection) {
    if (peerConnection.iceGatheringState === "complete") {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const handleStateChange = () => {
        if (peerConnection.iceGatheringState === "complete") {
          peerConnection.removeEventListener(
            "icegatheringstatechange",
            handleStateChange
          );
          resolve();
        }
      };
      peerConnection.addEventListener(
        "icegatheringstatechange",
        handleStateChange
      );
    });
  }

  async function openPeerConnections() {
    if (peerConnection1 || !shouldKeepActive()) return;

    const firstPeerConnection = new RTCPeerConnection();
    const secondPeerConnection = new RTCPeerConnection();
    peerConnection1 = firstPeerConnection;
    peerConnection2 = secondPeerConnection;

    try {
      secondPeerConnection.addEventListener("datachannel", (event) => {
        receivingChannel = event.channel;
      });

      sendingChannel = firstPeerConnection.createDataChannel(
        "tenko-keep-active"
      );
      sendingChannel.addEventListener("open", () => {
        if (shouldKeepActive()) {
          console.log(LOG_PREFIX, "バックグラウンド監視を開始しました。");
        }
      });

      const offer = await firstPeerConnection.createOffer();
      await firstPeerConnection.setLocalDescription(offer);
      await waitForIceGathering(firstPeerConnection);
      await secondPeerConnection.setRemoteDescription(
        firstPeerConnection.localDescription
      );

      const answer = await secondPeerConnection.createAnswer();
      await secondPeerConnection.setLocalDescription(answer);
      await waitForIceGathering(secondPeerConnection);
      await firstPeerConnection.setRemoteDescription(
        secondPeerConnection.localDescription
      );

      if (!shouldKeepActive()) closePeerConnections();
    } catch (error) {
      if (peerConnection1 === firstPeerConnection) {
        closePeerConnections();
        console.warn(
          LOG_PREFIX,
          "バックグラウンド監視の開始に失敗しました。",
          error
        );
      }
    }
  }

  function updateKeepActiveState() {
    if (shouldKeepActive()) {
      openPeerConnections();
    } else {
      closePeerConnections();
    }
  }

  function handleRouteChange() {
    updateKeepActiveState();
    document.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  }

  function installSpaRouteObserver() {
    for (const methodName of ["pushState", "replaceState"]) {
      const nativeMethod = history[methodName];
      history[methodName] = function (...args) {
        const result = nativeMethod.apply(this, args);
        queueMicrotask(handleRouteChange);
        return result;
      };
    }

    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("popstate", handleRouteChange);
  }

  installVisibilityOverrides();
  installSpaRouteObserver();
  document.addEventListener(SETTING_EVENT, (event) => {
    keepActiveEnabled = event.detail === true;
    updateKeepActiveState();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(
      new Event(keepActiveEnabled ? "focus" : "blur")
    );
    console.log(
      LOG_PREFIX,
      keepActiveEnabled
        ? "バックグラウンド監視を有効にしました。"
        : "バックグラウンド監視を無効にしました。"
    );
  });
  updateKeepActiveState();
})();
