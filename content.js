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
  const COMPOSER_TIMEOUT_MS = 6000;
  const SUBMIT_TIMEOUT_MS = 6000;

  const state = {
    theme: "dark"
  };

  let isSending = false;
  let toastTimer = 0;
  let themeTimer = 0;
  let highlightTimer = 0;

  const ui = createUi();

  void init();

  function init() {
    installThemeObserver();
    ui.mainButton.addEventListener("click", handleMainButton);
    syncTheme();
    themeTimer = window.setInterval(syncTheme, THEME_POLL_MS);
  }

  function createUi() {
    document.getElementById(ROOT_ID)?.remove();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "groktrue-root";
    root.innerHTML = `
      <div class="groktrue-dock">
        <button class="groktrue-main-button" type="button" aria-label="Reply with Grok">
          <span class="groktrue-icon-frame">
            <img class="groktrue-icon" src="${chrome.runtime.getURL("assets/button-icon.png")}" alt="" />
          </span>
          <span class="groktrue-button-copy">ASK GROK</span>
        </button>
      </div>
      <div class="groktrue-toast" aria-live="polite"></div>
    `;

    document.body.append(root);

    return {
      root,
      mainButton: root.querySelector(".groktrue-main-button"),
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

    flashTarget(context.article);
    setBusy(true);
    showToast("Replying…");

    try {
      await sendReplyViaNativeUi(context);
      showToast("Reply sent.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Reply failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  function setBusy(nextBusy) {
    isSending = nextBusy;
    ui.root.classList.toggle("groktrue-busy", nextBusy);
    ui.mainButton.disabled = nextBusy;
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

    const inserted = await replaceComposerText(textbox, REPLY_TEXT);
    if (!inserted) {
      throw new Error("Could not fill X's reply box.");
    }

    const readySubmitButton = await waitForEnabledSubmitButton(composer.container);
    clickElement(readySubmitButton);
    await waitForSubmitResult(composer.container, textbox);
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
      const alertText = getVisibleAlertText();
      if (alertText) {
        throw new Error(alertText);
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

  function getVisibleAlertText() {
    const alerts = Array.from(document.querySelectorAll("[role='alert'], [data-testid='toast']"));
    for (const alert of alerts) {
      if (!isVisible(alert)) {
        continue;
      }

      const text = normalizeSpace(alert.innerText || alert.textContent || "");
      if (text) {
        return text;
      }
    }

    return "";
  }

  function clickElement(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );
    element.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );
    element.click();
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

  function normalizeSpace(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }
})();
