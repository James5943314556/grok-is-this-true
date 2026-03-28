(() => {
  if (window.top !== window.self || window.__grokTrueOverlayLoaded) {
    return;
  }

  window.__grokTrueOverlayLoaded = true;

  const ROOT_ID = "groktrue-root";
  const TOAST_TIMEOUT_MS = 3200;
  const THEME_POLL_MS = 1000;
  const TARGET_FLASH_MS = 1250;
  const COMPOSER_TIMEOUT_MS = 6000;
  const SUBMIT_TIMEOUT_MS = 6000;
  const PROMPT_STORAGE_KEY = "groktrueSelectedPrompt";
  const DEFAULT_PROMPT_ID = "true";
  const PROMPT_OPTIONS = [
    {
      id: "true",
      label: "Is this true?",
      text: "@grok is this true?"
    },
    {
      id: "ai",
      label: "Is this AI?",
      text: "@grok is this ai?"
    },
    {
      id: "real",
      label: "Is this real?",
      text: "@grok is this real?"
    }
  ];
  const AUTHOR_ACTIONS = {
    mute: {
      label: "Mute poster",
      progress: "Muting poster…",
      success: "Poster muted.",
      alreadyMessage: "Poster is already muted.",
      present: /^mute\b/i,
      already: /^unmute\b/i,
      confirm: /^mute$/i
    }
  };

  const state = {
    theme: "dark",
    selectedPromptId: DEFAULT_PROMPT_ID
  };

  let isSending = false;
  let toastTimer = 0;
  let themeTimer = 0;
  let highlightTimer = 0;

  const ui = createUi();

  void init();

  async function init() {
    installThemeObserver();
    installNativeSuccessToastObserver();
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("scroll", handleViewportChange, { passive: true });
    window.addEventListener("resize", handleViewportChange);
    ui.mainButton.addEventListener("click", handleMainButton);
    ui.settingsToggle.addEventListener("click", toggleSettings);
    ui.promptButtons.forEach((button) => {
      button.addEventListener("click", handlePromptOptionClick);
    });
    ui.authorActionButtons.forEach((button) => {
      button.addEventListener("click", handleAuthorActionClick);
    });

    state.selectedPromptId = await readSelectedPromptId();
    applyPromptSelectionUi();
    syncTheme();
    themeTimer = window.setInterval(syncTheme, THEME_POLL_MS);
    decorateNativeSuccessToasts();
  }

  function createUi() {
    document.getElementById(ROOT_ID)?.remove();

    const promptOptionsMarkup = PROMPT_OPTIONS.map(
      (option) => `
        <button
          class="groktrue-prompt-option"
          type="button"
          data-prompt-id="${option.id}"
          aria-pressed="false"
        >
          ${option.label}
        </button>
      `
    ).join("");
    const authorActionButtonsMarkup = `
      <button class="groktrue-author-action-button" type="button" data-author-action="mute" aria-label="Mute poster" title="Mute poster">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 9.75h3.6l4.65-4.1a.75.75 0 0 1 1.25.56v11.58a.75.75 0 0 1-1.25.56l-4.65-4.1H4a1.75 1.75 0 0 1-1.75-1.75v-1a1.75 1.75 0 0 1 1.75-1.75Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
          <path d="M17.2 8.3 9 16.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M15.85 10.15a3.2 3.2 0 0 1 0 3.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "groktrue-root";
    root.innerHTML = `
      <div class="groktrue-dock">
        <div class="groktrue-launcher">
          <button class="groktrue-main-button" type="button" aria-label="Reply with Grok">
            <span class="groktrue-icon-frame">
              <img class="groktrue-icon" src="${chrome.runtime.getURL("assets/button-icon.png")}" alt="" />
            </span>
            <span class="groktrue-button-copy">ASK GROK</span>
          </button>
          <div class="groktrue-toolbar">
            ${authorActionButtonsMarkup}
            <button class="groktrue-settings-toggle" type="button" aria-label="Open settings" title="Settings">⚙</button>
          </div>
          <div class="groktrue-settings-popover" aria-hidden="true">
            <p class="groktrue-settings-kicker">Reply Prompt</p>
            <div class="groktrue-prompt-picker" role="group" aria-label="Reply prompt options">
              ${promptOptionsMarkup}
            </div>
          </div>
        </div>
      </div>
      <div class="groktrue-toast" aria-live="polite"></div>
    `;

    document.body.append(root);

    return {
      root,
      mainButton: root.querySelector(".groktrue-main-button"),
      settingsToggle: root.querySelector(".groktrue-settings-toggle"),
      settingsPopover: root.querySelector(".groktrue-settings-popover"),
      promptButtons: Array.from(root.querySelectorAll(".groktrue-prompt-option")),
      authorActionButtons: Array.from(root.querySelectorAll(".groktrue-author-action-button")),
      toast: root.querySelector(".groktrue-toast")
    };
  }

  async function handleMainButton(event) {
    event.preventDefault();
    event.stopPropagation();

    if (isSending) {
      return;
    }

    const context = getCenteredTweetContext();
    if (!context) {
      showToast("No target post is available right now.", "error");
      return;
    }

    closeSettings();
    flashTarget(context.article);
    setBusy(true);
    showToast(`Replying with ${getSelectedPromptText()}`);

    try {
      await sendReplyViaNativeUi(context);
      showToast("Reply sent.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Reply failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  function handlePromptOptionClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    if (!(button instanceof HTMLElement)) {
      return;
    }

    const nextPromptId = normalizePromptId(button.dataset.promptId);
    if (nextPromptId === state.selectedPromptId) {
      return;
    }

    state.selectedPromptId = nextPromptId;
    applyPromptSelectionUi();
    void persistSelectedPromptId(nextPromptId);
    showToast(`Selected ${getSelectedPromptLabel()}`, "success");
  }

  async function handleAuthorActionClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    if (!(button instanceof HTMLElement) || isSending) {
      return;
    }

    const actionType = button.dataset.authorAction;
    if (!isAuthorActionType(actionType)) {
      return;
    }

    const context = getCenteredTweetContext();
    if (!context) {
      showToast("No target post is available right now.", "error");
      return;
    }

    closeSettings();
    flashTarget(context.article);
    setBusy(true);
    showToast(AUTHOR_ACTIONS[actionType].progress);

    try {
      await performAuthorAction(context, actionType);
      showToast(AUTHOR_ACTIONS[actionType].success, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : `${AUTHOR_ACTIONS[actionType].label} failed.`,
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleSettings(event) {
    event.preventDefault();
    event.stopPropagation();

    if (isSending) {
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

  function handleDocumentPointerDown(event) {
    if (!ui.root.classList.contains("groktrue-settings-open")) {
      return;
    }

    const insideLauncher = event.target instanceof Element && event.target.closest(".groktrue-launcher");
    if (!insideLauncher) {
      closeSettings();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && ui.root.classList.contains("groktrue-settings-open")) {
      closeSettings();
    }
  }

  function handleViewportChange() {
    if (ui.root.classList.contains("groktrue-settings-open")) {
      closeSettings();
    }
  }

  function setBusy(nextBusy) {
    isSending = nextBusy;
    ui.root.classList.toggle("groktrue-busy", nextBusy);
    ui.mainButton.disabled = nextBusy;
    ui.settingsToggle.disabled = nextBusy;
    ui.promptButtons.forEach((button) => {
      button.disabled = nextBusy;
    });
    ui.authorActionButtons.forEach((button) => {
      button.disabled = nextBusy;
    });
  }

  function applyPromptSelectionUi() {
    ui.promptButtons.forEach((button) => {
      const isSelected = button.dataset.promptId === state.selectedPromptId;
      button.classList.toggle("groktrue-prompt-option-active", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });
  }

  async function sendReplyViaNativeUi(context) {
    const replyButton = context.replyButton || findReplyButton(context.article);
    if (!replyButton) {
      throw new Error("Could not find X's reply button for that post.");
    }

    const previousContainers = new Set(getComposerCandidates().map((candidate) => candidate.container));
    clickElement(replyButton);

    const composer = await waitForReplyComposer(previousContainers);
    const textbox = composer.textbox;
    const selectedPromptText = getSelectedPromptText();

    const inserted = await replaceComposerText(textbox, selectedPromptText);
    if (!inserted) {
      throw new Error("Could not fill X's reply box.");
    }

    const readySubmitButton = await waitForEnabledSubmitButton(composer.container);
    clickElement(readySubmitButton);
    await waitForSubmitResult(composer.container, textbox);
  }

  async function performAuthorAction(context, actionType) {
    const actionConfig = AUTHOR_ACTIONS[actionType];
    const menuButton = findArticleMenuButton(context.article);
    if (!menuButton) {
      throw new Error("Could not find the post menu for that author.");
    }

    clickElement(menuButton);
    const menu = await waitForVisibleMenu();
    const actionMatch = findAuthorActionMenuItem(menu, actionType);

    if (actionMatch.state === "already") {
      throw new Error(actionConfig.alreadyMessage);
    }

    if (!actionMatch.element) {
      throw new Error(`Could not find X's ${actionConfig.label.toLowerCase()} action.`);
    }

    clickElement(actionMatch.element);

    const confirmButton = await findOptionalConfirmButton(actionType);
    if (confirmButton instanceof HTMLElement) {
      await activateConfirmationButton(confirmButton, actionType);
    }

    await waitForAuthorActionResult(actionType);
  }

  async function waitForReplyComposer(previousContainers) {
    try {
      return await waitFor(
        () => {
          const freshCandidate = getComposerCandidates().find(
            (candidate) => !previousContainers.has(candidate.container)
          );
          return freshCandidate || null;
        },
        COMPOSER_TIMEOUT_MS / 2,
        "X did not open the reply composer in time."
      );
    } catch (error) {
      return waitFor(
        () => getComposerCandidates()[0] || null,
        COMPOSER_TIMEOUT_MS / 2,
        "X did not open the reply composer in time."
      );
    }
  }

  async function replaceComposerText(textbox, text) {
    focusEditable(textbox);
    await sleep(50);

    selectAllEditable(textbox);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch (error) {
      inserted = false;
    }

    if (!inserted || !composerContainsText(textbox, text)) {
      textbox.textContent = text;
      textbox.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: "insertText"
        })
      );
    }

    if (!composerContainsText(textbox, text)) {
      return false;
    }

    await sleep(120);
    return composerContainsText(textbox, text);
  }

  async function waitForEnabledSubmitButton(container) {
    return waitFor(() => {
      const button = findComposerSubmitButton(container);
      return button && !isDisabled(button) ? button : null;
    }, COMPOSER_TIMEOUT_MS, "X did not enable the Reply button.");
  }

  async function waitForSubmitResult(container, textbox) {
    await sleep(250);

    await waitFor(() => {
      const alertState = getVisibleAlertState();
      if (alertState.type === "success") {
        return true;
      }

      if (alertState.type === "error" && alertState.text) {
        throw new Error(alertState.text);
      }

      if (!document.contains(container) || !document.contains(textbox)) {
        return true;
      }

      if (!isVisible(textbox)) {
        return true;
      }

      const currentText = normalizeSpace(textbox.innerText || textbox.textContent || "");
      if (!currentText) {
        return true;
      }

      return null;
    }, SUBMIT_TIMEOUT_MS, "X did not finish sending the reply.");
  }

  async function waitForAuthorActionResult(actionType) {
    await sleep(250);

    await waitFor(() => {
      const alertState = getVisibleAlertState();
      if (alertState.type === "success") {
        return true;
      }

      if (alertState.type === "error" && alertState.text) {
        throw new Error(alertState.text);
      }

      const openMenu = Array.from(document.querySelectorAll("[role='menu'], [data-testid='Dropdown']")).find((menu) =>
        isVisible(menu)
      );
      const confirmButton = findConfirmationButton(AUTHOR_ACTIONS[actionType].confirm);
      if (!openMenu && !confirmButton) {
        return true;
      }

      return null;
    }, SUBMIT_TIMEOUT_MS, `${AUTHOR_ACTIONS[actionType].label} did not finish in time.`);
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

    return best || null;
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
      replyButton,
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

  function findArticleMenuButton(article) {
    return article.querySelector(
      "[data-testid='caret'], button[aria-label='More'], [role='button'][aria-label='More']"
    );
  }

  function findReplyButton(article) {
    return article.querySelector("[data-testid='reply']");
  }

  function getComposerCandidates() {
    const candidates = [];
    const seenContainers = new Set();

    for (const dialog of document.querySelectorAll("[role='dialog']")) {
      const candidate = buildComposerCandidate(dialog);
      if (candidate && !seenContainers.has(candidate.container)) {
        seenContainers.add(candidate.container);
        candidates.push(candidate);
      }
    }

    for (const textbox of document.querySelectorAll("[data-testid='tweetTextarea_0'], [role='textbox'][data-testid^='tweetTextarea_']")) {
      if (!isVisible(textbox)) {
        continue;
      }

      const container =
        textbox.closest("[role='dialog'], form, [data-testid='cellInnerDiv'], main") || textbox.parentElement;
      const candidate = buildComposerCandidate(container);
      if (candidate && !seenContainers.has(candidate.container)) {
        seenContainers.add(candidate.container);
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  function buildComposerCandidate(container) {
    if (!(container instanceof Element) || !isVisible(container)) {
      return null;
    }

    const textbox = Array.from(
      container.querySelectorAll("[data-testid='tweetTextarea_0'], [role='textbox'][data-testid^='tweetTextarea_']")
    ).find((element) => isVisible(element));

    if (!textbox) {
      return null;
    }

    return {
      container,
      textbox
    };
  }

  function findComposerSubmitButton(container) {
    if (!(container instanceof Element)) {
      return null;
    }

    const nodes = Array.from(
      container.querySelectorAll("[data-testid='tweetButton'], [data-testid='tweetButtonInline']")
    );

    for (const node of nodes) {
      const clickable = node.matches("button, [role='button']")
        ? node
        : node.querySelector("button, [role='button']");

      if (clickable && isVisible(clickable)) {
        return clickable;
      }
    }

    return null;
  }

  async function waitForVisibleMenu() {
    return waitFor(() => {
      const menus = Array.from(document.querySelectorAll("[role='menu'], [data-testid='Dropdown']"));
      return menus.find((menu) => isVisible(menu)) || null;
    }, COMPOSER_TIMEOUT_MS / 2, "X did not open the post menu in time.");
  }

  function findAuthorActionMenuItem(menu, actionType) {
    const config = AUTHOR_ACTIONS[actionType];
    const candidates = Array.from(menu.querySelectorAll("[role='menuitem'], button, a, [role='button']"));
    let alreadyPresent = false;

    for (const node of candidates) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) {
        continue;
      }

      const text = normalizeSpace(node.innerText || node.textContent || "");
      if (!text) {
        continue;
      }

      if (config.already.test(text)) {
        alreadyPresent = true;
      }

      if (config.present.test(text) && !config.already.test(text)) {
        const clickable = getClickableElement(node);
        return {
          state: "ready",
          element: clickable || node
        };
      }
    }

    return {
      state: alreadyPresent ? "already" : "missing",
      element: null
    };
  }

  async function findOptionalConfirmButton(actionType) {
    const confirmPattern = AUTHOR_ACTIONS[actionType].confirm;
    const startedAt = Date.now();

    while (Date.now() - startedAt < 1400) {
      const confirmButton = findConfirmationButton(confirmPattern);
      if (confirmButton) {
        return confirmButton;
      }

      await sleep(50);
    }

    return null;
  }

  async function activateConfirmationButton(button, actionType) {
    const confirmPattern = AUTHOR_ACTIONS[actionType].confirm;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const liveButton = findConfirmationButton(confirmPattern) || button;
      if (!(liveButton instanceof HTMLElement)) {
        return;
      }

      liveButton.focus();
      clickElement(liveButton);
      await sleep(160);

      if (!findConfirmationButton(confirmPattern)) {
        return;
      }

      liveButton.focus();
      pressElementWithKeyboard(liveButton, "Enter");
      await sleep(160);

      if (!findConfirmationButton(confirmPattern)) {
        return;
      }

      liveButton.focus();
      pressElementWithKeyboard(liveButton, " ");
      await sleep(160);

      if (!findConfirmationButton(confirmPattern)) {
        return;
      }
    }

    throw new Error(`Could not confirm ${AUTHOR_ACTIONS[actionType].label.toLowerCase()}.`);
  }

  function findConfirmationButton(pattern) {
    const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));

    for (const dialog of dialogs) {
      if (!isVisible(dialog)) {
        continue;
      }

      const confirmByTestId = dialog.querySelector("[data-testid='confirmationSheetConfirm']");
      if (confirmByTestId instanceof Element && isVisible(confirmByTestId)) {
        const clickable = getClickableElement(confirmByTestId);
        if (clickable instanceof HTMLElement && isVisible(clickable) && !isDisabled(clickable)) {
          return clickable;
        }
      }

      const candidates = Array.from(dialog.querySelectorAll("button, [role='button']"));
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
          continue;
        }

        const text = normalizeSpace(candidate.innerText || candidate.textContent || "");
        if (pattern.test(text) && !isDisabled(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }
  function getClickableElement(node) {
    if (!(node instanceof Element)) {
      return null;
    }

    const closestClickable = node.closest("button, [role='button']");
    if (closestClickable) {
      return closestClickable;
    }

    if (node.matches("button, [role='button']")) {
      return node;
    }

    return node.querySelector("button, [role='button']");
  }

  function resolveInteractiveTarget(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(clientX, clientY);
    const hitClickable = getClickableElement(hit);

    if (hitClickable instanceof HTMLElement && isVisible(hitClickable)) {
      return hitClickable;
    }

    const directClickable = getClickableElement(element);
    if (directClickable instanceof HTMLElement && isVisible(directClickable)) {
      return directClickable;
    }

    return element;
  }

  function getVisibleAlertState() {
    const alerts = Array.from(document.querySelectorAll("[role='alert'], [data-testid='toast']"));
    for (const alert of alerts) {
      if (!isVisible(alert)) {
        continue;
      }

      const text = normalizeSpace(alert.innerText || alert.textContent || "");
      if (text) {
        if (isSuccessToastText(text)) {
          return {
            type: "success",
            text
          };
        }

        return {
          type: "error",
          text
        };
      }
    }

    return {
      type: "",
      text: ""
    };
  }

  function installNativeSuccessToastObserver() {
    const observer = new MutationObserver(() => {
      decorateNativeSuccessToasts();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function decorateNativeSuccessToasts() {
    const alerts = document.querySelectorAll("[role='alert'], [data-testid='toast']");
    for (const alert of alerts) {
      if (!(alert instanceof HTMLElement)) {
        continue;
      }

      const text = normalizeSpace(alert.innerText || alert.textContent || "");
      const isSuccessToast = isSuccessToastText(text);
      alert.classList.toggle("groktrue-native-success-toast", isSuccessToast);

      const actionNodes = alert.querySelectorAll("a, button, [role='button']");
      for (const actionNode of actionNodes) {
        if (!(actionNode instanceof HTMLElement)) {
          continue;
        }

        const actionText = normalizeSpace(actionNode.innerText || actionNode.textContent || "");
        const isViewAction = isSuccessToast && /^(view|open)$/i.test(actionText);
        actionNode.classList.toggle("groktrue-native-success-toast-action", isViewAction);
      }
    }
  }

  function clickElement(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const target = resolveInteractiveTarget(element);
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    target.focus();

    if (typeof PointerEvent === "function") {
      target.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX,
          clientY
        })
      );
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX,
          clientY
        })
      );
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX,
          clientY,
          button: 0,
          buttons: 1
        })
      );
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX,
          clientY,
          button: 0,
          buttons: 0
        })
      );
    }

    target.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY
      })
    );
    target.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY
      })
    );
    target.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons: 1,
        detail: 1
      })
    );
    target.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons: 0,
        detail: 1
      })
    );
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons: 0,
        detail: 1
      })
    );
    target.click();
  }

  function pressElementWithKeyboard(element, key) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const normalizedKey = key === " " ? " " : key;
    const normalizedCode = key === " " ? "Space" : key;

    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: normalizedKey,
        code: normalizedCode,
        bubbles: true,
        cancelable: true
      })
    );
    element.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: normalizedKey,
        code: normalizedCode,
        bubbles: true,
        cancelable: true
      })
    );
  }

  function focusEditable(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.focus();
    clickElement(element);
  }

  function selectAllEditable(element) {
    if (!(element instanceof Element)) {
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      document.execCommand("selectAll", false);
    } catch (error) {
      // Ignore deprecated command failures and keep the manual selection.
    }
  }

  function composerContainsText(element, text) {
    const value = normalizeSpace(element.innerText || element.textContent || "");
    return value === normalizeSpace(text);
  }

  async function waitFor(resolveValue, timeoutMs, timeoutMessage) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const value = resolveValue();
      if (value) {
        return value;
      }

      await sleep(50);
    }

    throw new Error(timeoutMessage || "Timed out waiting for X.");
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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
    if (!(element instanceof Element)) {
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

  function isDisabled(element) {
    return (
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.disabled === true
    );
  }

  async function readSelectedPromptId() {
    try {
      if (!chrome?.storage?.local) {
        return DEFAULT_PROMPT_ID;
      }

      const result = await chrome.storage.local.get(PROMPT_STORAGE_KEY);
      return normalizePromptId(result?.[PROMPT_STORAGE_KEY]);
    } catch (error) {
      return DEFAULT_PROMPT_ID;
    }
  }

  async function persistSelectedPromptId(promptId) {
    try {
      if (!chrome?.storage?.local) {
        return;
      }

      await chrome.storage.local.set({
        [PROMPT_STORAGE_KEY]: normalizePromptId(promptId)
      });
    } catch (error) {
      // Ignore storage failures and keep the in-memory selection.
    }
  }

  function getSelectedPrompt() {
    return PROMPT_OPTIONS.find((option) => option.id === state.selectedPromptId) || PROMPT_OPTIONS[0];
  }

  function getSelectedPromptText() {
    return getSelectedPrompt().text;
  }

  function getSelectedPromptLabel() {
    return getSelectedPrompt().label;
  }

  function normalizePromptId(value) {
    return PROMPT_OPTIONS.some((option) => option.id === value) ? value : DEFAULT_PROMPT_ID;
  }

  function isAuthorActionType(value) {
    return value === "mute";
  }

  function normalizeSpace(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function isSuccessToastText(text) {
    return /^(your (post|reply) was sent|muted\b)/i.test(text);
  }
})();
