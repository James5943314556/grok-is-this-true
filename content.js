(() => {
  if (window.top !== window.self || window.__grokTrueOverlayLoaded) {
    return;
  }

  window.__grokTrueOverlayLoaded = true;

  const REPLY_TEXT = "@grok is this true?";
  const ROOT_ID = "groktrue-root";
  const TOAST_TIMEOUT_MS = 3200;
  const THEME_POLL_MS = 1000;
  const TARGET_FLASH_MS = 1250;
  const CONTEXT_RELOAD_FLAG = "groktrue-context-reload";

  const state = {
    theme: "dark",
    auth: {
      loading: true,
      connected: false,
      configured: false,
      profile: null,
      method: ""
    }
  };

  let activeContext = null;
  let isSending = false;
  let toastTimer = 0;
  let themeTimer = 0;
  let highlightTimer = 0;

  const ui = createUi();

  void init();

  async function init() {
    installThemeObserver();
    window.addEventListener("keydown", handleKeydown);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    window.addEventListener("scroll", handleViewportChange, { passive: true });
    window.addEventListener("resize", handleViewportChange);
    ui.mainButton.addEventListener("click", handleMainButton);
    ui.settingsToggle.addEventListener("click", toggleSettings);
    ui.cancelButton.addEventListener("click", closeModal);
    ui.closeButton.addEventListener("click", closeModal);
    ui.backdrop.addEventListener("click", handleBackdropClick);
    ui.sendButton.addEventListener("click", handleModalSend);
    ui.authConnectButton.addEventListener("click", handleAuthConnect);
    ui.settingsSaveButton.addEventListener("click", handleSettingsSave);
    ui.logoutButton.addEventListener("click", handleLogout);

    ui.preview.textContent = REPLY_TEXT;
    ui.authStatus.textContent = "Checking X connection…";
    syncTheme();
    themeTimer = window.setInterval(syncTheme, THEME_POLL_MS);
    await refreshAuthState();
  }

  function createUi() {
    document.getElementById(ROOT_ID)?.remove();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "groktrue-root";
    root.dataset.auth = "loading";
    root.innerHTML = `
      <div class="groktrue-dock">
        <div class="groktrue-auth-card">
          <p class="groktrue-auth-kicker">Connect X</p>
          <h2 class="groktrue-auth-title">Connect X API</h2>
          <p class="groktrue-auth-copy">Paste your OAuth 1.0a keys to connect this browser profile and send replies through the X API.</p>
          <label class="groktrue-field">
            <span class="groktrue-field-label">Consumer Key</span>
            <input class="groktrue-client-id-input groktrue-oauth1-consumer-key" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <label class="groktrue-field">
            <span class="groktrue-field-label">Consumer Secret</span>
            <input class="groktrue-client-id-input groktrue-oauth1-consumer-secret" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <label class="groktrue-field">
            <span class="groktrue-field-label">Access Token</span>
            <input class="groktrue-client-id-input groktrue-oauth1-access-token" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <label class="groktrue-field">
            <span class="groktrue-field-label">Access Token Secret</span>
            <input class="groktrue-client-id-input groktrue-oauth1-access-token-secret" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <label class="groktrue-field">
            <span class="groktrue-field-label">Screen Name (Optional)</span>
            <input class="groktrue-client-id-input groktrue-oauth1-screen-name" type="text" autocomplete="off" spellcheck="false" placeholder="@yourhandle" />
          </label>
          <p class="groktrue-auth-status" role="status" aria-live="polite"></p>
          <div class="groktrue-auth-actions">
            <button class="groktrue-auth-button" type="button">Save Keys</button>
          </div>
        </div>
        <div class="groktrue-launcher">
          <button class="groktrue-main-button" type="button" aria-label="Reply with Grok">
            <span class="groktrue-icon-frame">
              <img class="groktrue-icon" src="${chrome.runtime.getURL("assets/button-icon.png")}" alt="" />
            </span>
            <span class="groktrue-button-copy">ASK GROK</span>
          </button>
          <button class="groktrue-settings-toggle" type="button" aria-label="Open settings">⚙</button>
          <div class="groktrue-settings-popover" aria-hidden="true">
            <p class="groktrue-settings-label">X account</p>
            <div class="groktrue-account-panel">
              <p class="groktrue-account-handle">Not connected</p>
              <button class="groktrue-logout-button" type="button">Disconnect</button>
            </div>
            <p class="groktrue-settings-label">Local API Keys</p>
            <p class="groktrue-settings-copy">Re-enter all four secret fields to replace the keys stored locally in this browser.</p>
            <label class="groktrue-field">
              <span class="groktrue-field-label">Consumer Key</span>
              <input class="groktrue-client-id-input groktrue-settings-oauth1-consumer-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste to replace" />
            </label>
            <label class="groktrue-field">
              <span class="groktrue-field-label">Consumer Secret</span>
              <input class="groktrue-client-id-input groktrue-settings-oauth1-consumer-secret" type="password" autocomplete="off" spellcheck="false" placeholder="Paste to replace" />
            </label>
            <label class="groktrue-field">
              <span class="groktrue-field-label">Access Token</span>
              <input class="groktrue-client-id-input groktrue-settings-oauth1-access-token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste to replace" />
            </label>
            <label class="groktrue-field">
              <span class="groktrue-field-label">Access Token Secret</span>
              <input class="groktrue-client-id-input groktrue-settings-oauth1-access-token-secret" type="password" autocomplete="off" spellcheck="false" placeholder="Paste to replace" />
            </label>
            <label class="groktrue-field">
              <span class="groktrue-field-label">Screen Name (Optional)</span>
              <input class="groktrue-client-id-input groktrue-settings-oauth1-screen-name" type="text" autocomplete="off" spellcheck="false" placeholder="@yourhandle" />
            </label>
            <button class="groktrue-auth-button groktrue-settings-save" type="button">Save Keys</button>
          </div>
        </div>
      </div>
      <div class="groktrue-backdrop"></div>
      <div class="groktrue-modal" role="dialog" aria-modal="true" aria-labelledby="groktrue-title">
        <div class="groktrue-modal-header">
          <h2 id="groktrue-title">Ask Grok</h2>
          <button class="groktrue-close" type="button" aria-label="Close confirm popup">×</button>
        </div>
        <pre class="groktrue-preview"></pre>
        <p class="groktrue-status" role="status" aria-live="polite"></p>
        <div class="groktrue-actions">
          <button class="groktrue-secondary" type="button">Cancel</button>
          <button class="groktrue-primary" type="button">Send</button>
        </div>
      </div>
      <div class="groktrue-toast" aria-live="polite"></div>
    `;

    document.body.append(root);

    return {
      root,
      authCard: root.querySelector(".groktrue-auth-card"),
      authStatus: root.querySelector(".groktrue-auth-status"),
      authConnectButton: root.querySelector(".groktrue-auth-button"),
      oauth1ConsumerKeyInput: root.querySelector(".groktrue-oauth1-consumer-key"),
      oauth1ConsumerSecretInput: root.querySelector(".groktrue-oauth1-consumer-secret"),
      oauth1AccessTokenInput: root.querySelector(".groktrue-oauth1-access-token"),
      oauth1AccessTokenSecretInput: root.querySelector(".groktrue-oauth1-access-token-secret"),
      oauth1ScreenNameInput: root.querySelector(".groktrue-oauth1-screen-name"),
      mainButton: root.querySelector(".groktrue-main-button"),
      settingsToggle: root.querySelector(".groktrue-settings-toggle"),
      settingsPopover: root.querySelector(".groktrue-settings-popover"),
      settingsOauth1ConsumerKeyInput: root.querySelector(".groktrue-settings-oauth1-consumer-key"),
      settingsOauth1ConsumerSecretInput: root.querySelector(".groktrue-settings-oauth1-consumer-secret"),
      settingsOauth1AccessTokenInput: root.querySelector(".groktrue-settings-oauth1-access-token"),
      settingsOauth1AccessTokenSecretInput: root.querySelector(".groktrue-settings-oauth1-access-token-secret"),
      settingsOauth1ScreenNameInput: root.querySelector(".groktrue-settings-oauth1-screen-name"),
      settingsSaveButton: root.querySelector(".groktrue-settings-save"),
      accountHandle: root.querySelector(".groktrue-account-handle"),
      logoutButton: root.querySelector(".groktrue-logout-button"),
      backdrop: root.querySelector(".groktrue-backdrop"),
      modal: root.querySelector(".groktrue-modal"),
      closeButton: root.querySelector(".groktrue-close"),
      preview: root.querySelector(".groktrue-preview"),
      status: root.querySelector(".groktrue-status"),
      cancelButton: root.querySelector(".groktrue-secondary"),
      sendButton: root.querySelector(".groktrue-primary"),
      toast: root.querySelector(".groktrue-toast")
    };
  }

  async function refreshAuthState(statusMessage = "") {
    state.auth.loading = true;
    applyAuthState(statusMessage || "Checking X connection…");

    try {
      const response = await sendRuntimeMessage({ type: "X_AUTH_STATUS" });
      if (!response?.ok) {
        throw new Error(response?.message || "Could not read X auth status.");
      }

      applyAuthResponse(response);
      applyAuthState(statusMessage);
    } catch (error) {
      state.auth.loading = false;
      state.auth.connected = false;
      state.auth.configured = false;
      state.auth.profile = null;
      state.auth.method = "";
      applyAuthState(error instanceof Error ? error.message : "Could not load X auth.");
    }
  }

  function applyAuthState(statusMessage = "") {
    ui.root.dataset.auth = state.auth.loading
      ? "loading"
      : state.auth.connected
        ? "connected"
        : "disconnected";

    if (!state.auth.connected) {
      activeContext = null;
      setStatus("");
      closeSettings();
    }
    ui.authConnectButton.disabled = state.auth.loading || isSending;
    ui.settingsToggle.disabled = state.auth.loading || isSending;
    ui.mainButton.disabled = state.auth.loading || isSending;
    ui.logoutButton.disabled = state.auth.loading || isSending || !state.auth.connected;
    ui.oauth1ConsumerKeyInput.disabled = state.auth.loading || isSending;
    ui.oauth1ConsumerSecretInput.disabled = state.auth.loading || isSending;
    ui.oauth1AccessTokenInput.disabled = state.auth.loading || isSending;
    ui.oauth1AccessTokenSecretInput.disabled = state.auth.loading || isSending;
    ui.oauth1ScreenNameInput.disabled = state.auth.loading || isSending;
    ui.settingsOauth1ConsumerKeyInput.disabled = state.auth.loading || isSending;
    ui.settingsOauth1ConsumerSecretInput.disabled = state.auth.loading || isSending;
    ui.settingsOauth1AccessTokenInput.disabled = state.auth.loading || isSending;
    ui.settingsOauth1AccessTokenSecretInput.disabled = state.auth.loading || isSending;
    ui.settingsOauth1ScreenNameInput.disabled = state.auth.loading || isSending;
    ui.settingsSaveButton.disabled = state.auth.loading || isSending;

    if (state.auth.loading) {
      ui.authStatus.textContent = statusMessage || "Checking X connection…";
    } else if (state.auth.connected) {
      const accountLabel = getAccountLabel();
      ui.authStatus.textContent = statusMessage || `Connected as ${accountLabel}.`;
      ui.accountHandle.textContent = accountLabel;
    } else if (!state.auth.configured) {
      ui.authStatus.textContent = statusMessage || "Enter your local OAuth 1.0a keys to connect.";
      ui.accountHandle.textContent = "Not connected";
    } else {
      ui.authStatus.textContent = statusMessage || "Paste your local OAuth 1.0a keys above to connect.";
      ui.accountHandle.textContent = "Not connected";
    }
  }

  async function handleAuthConnect(event) {
    event.preventDefault();

    const oauth1Payload = readOauth1Payload("auth");
    const oauth1FilledCount = countFilledOauth1Fields(oauth1Payload);
    if (oauth1FilledCount > 0) {
      if (oauth1FilledCount < 4) {
        applyAuthState("Fill consumer key, consumer secret, access token, and access token secret.");
        return;
      }

      state.auth.loading = true;
      applyAuthState("Saving local OAuth 1.0a keys…");

      try {
        const response = await sendRuntimeMessage({
          type: "X_AUTH_SAVE_OAUTH1",
          payload: oauth1Payload
        });

        if (!response?.ok) {
          throw new Error(response?.message || "Could not save local X API keys.");
        }

        applyAuthResponse(response);
        clearOauth1Inputs("auth");
        applyAuthState();
        showToast(`Connected as ${getAccountLabel()}.`);
      } catch (error) {
        state.auth.loading = false;
        applyAuthState(error instanceof Error ? error.message : "Could not save local X API keys.");
      }
      return;
    }

    applyAuthState("Enter your X API keys to connect.");
  }

  async function handleSettingsSave(event) {
    event.preventDefault();
    event.stopPropagation();

    const oauth1Payload = readOauth1Payload("settings");
    const oauth1FilledCount = countFilledOauth1Fields(oauth1Payload);
    if (oauth1FilledCount < 4) {
      showToast("Re-enter all four secret fields to replace the saved keys.", "error");
      return;
    }

    state.auth.loading = true;
    applyAuthState("Saving local OAuth 1.0a keys…");

    try {
      const response = await sendRuntimeMessage({
        type: "X_AUTH_SAVE_OAUTH1",
        payload: oauth1Payload
      });

      if (!response?.ok) {
        throw new Error(response?.message || "Could not save local X API keys.");
      }

      applyAuthResponse(response);
      clearOauth1Inputs("settings");
      applyAuthState();
      showToast(`Saved keys for ${getAccountLabel()}.`);
    } catch (error) {
      state.auth.loading = false;
      applyAuthState();
      showToast(error instanceof Error ? error.message : "Could not save local X API keys.", "error");
    }
  }

  async function handleLogout(event) {
    event.preventDefault();
    closeSettings();

    try {
      const response = await sendRuntimeMessage({ type: "X_AUTH_LOGOUT" });
      if (!response?.ok) {
        throw new Error(response?.message || "Could not disconnect X.");
      }

      await refreshAuthState("Disconnected from X.");
      showToast("Disconnected from X.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not disconnect X.", "error");
    }
  }

  function handleMainButton(event) {
    event.preventDefault();
    event.stopPropagation();

    if (isSending || !state.auth.connected) {
      return;
    }

    closeSettings();

    const context = getCenteredTweetContext();
    if (!context) {
      showToast("No target tweet is available right now.", "error");
      return;
    }

    flashTarget(context.article);
    void performSend(context, { fastSend: true });
  }

  async function handleModalSend() {
    const context = activeContext;
    if (!context) {
      setStatus("No target tweet is available right now.", "error");
      return;
    }

    flashTarget(context.article);
    await performSend(context, { fastSend: false });
  }

  function handleDocumentPointerDown(event) {
    if (ui.root.classList.contains("groktrue-settings-open")) {
      const insideLauncher = event.target instanceof Element && event.target.closest(".groktrue-launcher");
      if (!insideLauncher) {
        closeSettings();
      }
    }
  }

  function handleViewportChange() {
    if (ui.root.classList.contains("groktrue-settings-open")) {
      closeSettings();
    }
  }

  function handleKeydown(event) {
    if (event.key !== "Escape" || isSending) {
      return;
    }

    if (ui.root.classList.contains("groktrue-settings-open")) {
      closeSettings();
      return;
    }

    if (ui.root.classList.contains("groktrue-modal-open")) {
      closeModal();
    }
  }

  function toggleSettings(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!state.auth.connected) {
      return;
    }

    ui.root.classList.toggle("groktrue-settings-open");
    ui.settingsPopover.setAttribute(
      "aria-hidden",
      String(!ui.root.classList.contains("groktrue-settings-open"))
    );
  }

  function closeSettings() {
    ui.root.classList.remove("groktrue-settings-open");
    ui.settingsPopover.setAttribute("aria-hidden", "true");
  }

  function handleBackdropClick() {
    closeModal();
  }

  function closeModal() {
    if (isSending) {
      return;
    }

    activeContext = null;
    setStatus("");
    ui.root.classList.remove("groktrue-modal-open");
  }

  function setBusy(nextBusy) {
    isSending = nextBusy;
    ui.root.classList.toggle("groktrue-busy", nextBusy);
    ui.mainButton.disabled = nextBusy || !state.auth.connected || state.auth.loading;
    ui.settingsToggle.disabled = nextBusy || !state.auth.connected || state.auth.loading;
    ui.cancelButton.disabled = nextBusy;
    ui.sendButton.disabled = nextBusy;
    ui.closeButton.disabled = nextBusy;
    ui.authConnectButton.disabled = nextBusy || state.auth.loading;
    ui.oauth1ConsumerKeyInput.disabled = nextBusy || state.auth.loading;
    ui.oauth1ConsumerSecretInput.disabled = nextBusy || state.auth.loading;
    ui.oauth1AccessTokenInput.disabled = nextBusy || state.auth.loading;
    ui.oauth1AccessTokenSecretInput.disabled = nextBusy || state.auth.loading;
    ui.oauth1ScreenNameInput.disabled = nextBusy || state.auth.loading;
    ui.settingsOauth1ConsumerKeyInput.disabled = nextBusy || state.auth.loading;
    ui.settingsOauth1ConsumerSecretInput.disabled = nextBusy || state.auth.loading;
    ui.settingsOauth1AccessTokenInput.disabled = nextBusy || state.auth.loading;
    ui.settingsOauth1AccessTokenSecretInput.disabled = nextBusy || state.auth.loading;
    ui.settingsOauth1ScreenNameInput.disabled = nextBusy || state.auth.loading;
    ui.settingsSaveButton.disabled = nextBusy || state.auth.loading;
    ui.logoutButton.disabled = nextBusy || state.auth.loading || !state.auth.connected;
    ui.modal.setAttribute("aria-busy", String(nextBusy));
  }

  function applyAuthResponse(response) {
    state.auth.loading = false;
    state.auth.connected = Boolean(response?.connected);
    state.auth.configured = Boolean(response?.configured);
    state.auth.profile = response?.profile || null;
    state.auth.method = typeof response?.authMethod === "string" ? response.authMethod : "";
  }

  function getAccountLabel() {
    if (state.auth.profile?.username) {
      return `@${state.auth.profile.username}`;
    }

    if (state.auth.profile?.name) {
      return state.auth.profile.name;
    }

    if (state.auth.profile?.id) {
      return "your X account";
    }

    if (state.auth.method === "oauth1") {
      return "local OAuth 1.0a keys";
    }

    return "X connected";
  }

  function readOauth1Payload(source = "auth") {
    const isSettings = source === "settings";
    return {
      consumerKey: (isSettings ? ui.settingsOauth1ConsumerKeyInput : ui.oauth1ConsumerKeyInput).value.trim(),
      consumerSecret: (isSettings ? ui.settingsOauth1ConsumerSecretInput : ui.oauth1ConsumerSecretInput).value.trim(),
      accessToken: (isSettings ? ui.settingsOauth1AccessTokenInput : ui.oauth1AccessTokenInput).value.trim(),
      accessTokenSecret: (isSettings ? ui.settingsOauth1AccessTokenSecretInput : ui.oauth1AccessTokenSecretInput).value.trim(),
      screenName: (isSettings ? ui.settingsOauth1ScreenNameInput : ui.oauth1ScreenNameInput).value.trim()
    };
  }

  function clearOauth1Inputs(source = "auth") {
    const isSettings = source === "settings";
    const fields = isSettings
      ? [
          ui.settingsOauth1ConsumerKeyInput,
          ui.settingsOauth1ConsumerSecretInput,
          ui.settingsOauth1AccessTokenInput,
          ui.settingsOauth1AccessTokenSecretInput,
          ui.settingsOauth1ScreenNameInput
        ]
      : [
          ui.oauth1ConsumerKeyInput,
          ui.oauth1ConsumerSecretInput,
          ui.oauth1AccessTokenInput,
          ui.oauth1AccessTokenSecretInput,
          ui.oauth1ScreenNameInput
        ];

    for (const field of fields) {
      field.value = "";
    }
  }

  function countFilledOauth1Fields(payload) {
    return [
      payload.consumerKey,
      payload.consumerSecret,
      payload.accessToken,
      payload.accessTokenSecret
    ].filter(Boolean).length;
  }

  function setStatus(message, type = "") {
    ui.status.textContent = message;
    ui.status.dataset.state = type;
  }

  function showToast(message, type = "") {
    window.clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.dataset.state = type;
    ui.toast.classList.add("groktrue-toast-visible");

    toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove("groktrue-toast-visible");
    }, TOAST_TIMEOUT_MS);
  }

  async function performSend(context, { fastSend }) {
    if (isSending) {
      return;
    }

    if (!state.auth.connected) {
      showToast("Connect X before sending replies.", "error");
      await refreshAuthState("Connect X before sending replies.");
      return;
    }

    setBusy(true);
    closeSettings();

    if (fastSend) {
      showToast("Fast: replying now…");
    } else {
      setStatus("Sending reply through the X API…");
    }

    try {
      const response = await sendRuntimeMessage({
        type: "X_REPLY_TO_TWEET",
        payload: {
          tweetId: context.tweetId,
          text: REPLY_TEXT
        }
      });

      if (!response?.ok) {
        throw new Error(response?.message || "Reply failed.");
      }

      if (!fastSend) {
        ui.root.classList.remove("groktrue-modal-open");
      }

      activeContext = null;
      showToast(fastSend ? "Fast reply sent." : "Reply sent.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reply failed.";
      if (fastSend) {
        showToast(message, "error");
      } else {
        setStatus(message, "error");
      }

      if (/connect|session expired|client id|unauthorized|rejected the authenticated user lookup/i.test(message)) {
        await refreshAuthState(message);
      }
    } finally {
      setBusy(false);
    }
  }

  function getCenteredTweetContext() {
    const centerY = window.innerHeight / 2;
    let best = null;

    for (const context of getDiscoveredTweetContexts()) {
      const { article } = context;
      const rect = article.getBoundingClientRect();
      const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      const visibleWidth = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
      if (visibleHeight < 80 || visibleWidth < 80) {
        continue;
      }

      const articleCenterY = rect.top + rect.height / 2;
      const overlapsCenterLine = rect.top <= centerY && rect.bottom >= centerY;
      const score = Math.abs(articleCenterY - centerY) + (overlapsCenterLine ? 0 : 10000);

      if (!best || score < best.score) {
        best = {
          ...context,
          score
        };
      }
    }

    if (!best) {
      return null;
    }

    return {
      article: best.article,
      tweetPath: best.tweetPath,
      tweetId: best.tweetId
    };
  }

  function flashTarget(article) {
    if (!article) {
      return;
    }

    window.clearTimeout(highlightTimer);
    document.querySelector(".groktrue-targeted-article")?.classList.remove("groktrue-targeted-article");
    article.classList.add("groktrue-targeted-article");
    highlightTimer = window.setTimeout(() => {
      article.classList.remove("groktrue-targeted-article");
    }, TARGET_FLASH_MS);
  }

  function findReplyButton(article) {
    return article.querySelector("[data-testid='reply']");
  }

  function getDiscoveredTweetContexts() {
    const contexts = [];

    for (const article of document.querySelectorAll("article")) {
      const context = getTweetContextForArticle(article);
      if (context) {
        contexts.push(context);
      }
    }

    return contexts;
  }

  function getTweetContextForArticle(article) {
    const tweetPath = getTweetPath(article);
    const tweetId = getTweetIdFromPath(tweetPath);
    const replyButton = findReplyButton(article);
    if (!tweetPath || !tweetId || !replyButton || !isVisible(article)) {
      return null;
    }

    return {
      article,
      tweetPath,
      tweetId
    };
  }

  function getTweetPath(article) {
    const statusLink = getPreferredStatusLink(article);

    if (!statusLink) {
      return "";
    }

    return normalizeTweetPath(statusLink.getAttribute("href") || "");
  }

  function getPreferredStatusLink(article) {
    const statusLinks = Array.from(article.querySelectorAll("a[href*='/status/']")).filter((link) => {
      const href = link.getAttribute("href") || "";
      return /\/status\/\d+/.test(href);
    });

    const timestampLink = statusLinks.find((link) => link.querySelector("time"));
    return timestampLink || statusLinks[0] || null;
  }

  function normalizeTweetPath(rawHref) {
    try {
      const url = new URL(rawHref, location.origin);
      return url.pathname.replace(/\/photo\/\d+$/, "").replace(/\/analytics$/, "");
    } catch (error) {
      return "";
    }
  }

  function getTweetIdFromPath(tweetPath) {
    const match = tweetPath.match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  function installThemeObserver() {
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });

    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"]
      });
    }
  }

  function syncTheme() {
    const nextTheme = detectTheme();
    if (nextTheme !== state.theme) {
      state.theme = nextTheme;
      ui.root.dataset.theme = nextTheme;
    }
  }

  function detectTheme() {
    const sources = [
      document.querySelector("[data-testid='primaryColumn']"),
      document.body,
      document.documentElement
    ];

    for (const source of sources) {
      if (!(source instanceof Element)) {
        continue;
      }

      const color = parseRgb(window.getComputedStyle(source).backgroundColor);
      if (!color) {
        continue;
      }

      const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
      return luminance < 128 ? "dark" : "light";
    }

    return "dark";
  }

  function parseRgb(rawColor) {
    const match = rawColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) {
      return null;
    }

    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3])
    };
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(normalizeRuntimeError(runtimeError.message));
          return;
        }

        resolve(response);
      });
    });
  }

  function normalizeRuntimeError(message) {
    if (typeof message === "string" && message.includes("Extension context invalidated")) {
      scheduleContextRecovery();
      return new Error("The extension was reloaded. Refreshing X now…");
    }

    return new Error(typeof message === "string" ? message : "Extension request failed.");
  }

  function scheduleContextRecovery() {
    try {
      const lastReloadAt = Number(window.sessionStorage.getItem(CONTEXT_RELOAD_FLAG) || "0");
      if (Date.now() - lastReloadAt < 5000) {
        return;
      }

      window.sessionStorage.setItem(CONTEXT_RELOAD_FLAG, String(Date.now()));
    } catch (error) {
      // Ignore storage access failures and still reload once.
    }

    window.setTimeout(() => {
      window.location.reload();
    }, 150);
  }

})();
