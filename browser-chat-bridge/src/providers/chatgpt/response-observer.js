// src/providers/chatgpt/response-observer.js
// DOM-diff based observer.
// Compatible with the existing ChatGPTAdapter public API.

import {
  getConversationRoot,
  getElementMarkdown,
  findStopButton
} from "./selectors.js";

// ============================================================
// Timing
// ============================================================

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_SETTLE_MS = 1_200;
const DEFAULT_POLL_INTERVAL_MS = 250;

// ============================================================
// Current ChatGPT response DOM
// ============================================================
//
// Current preferred structure:
//
// [data-content-search-unit-key="UUID:1:assistant"]
// └── [data-markdown-text-style="assistant-message"]
//     ├── p
//     ├── h1..h6
//     ├── pre / code
//     ├── ul / ol
//     ├── table
//     └── other rich content
//
// Older ChatGPT structures remain as fallbacks.
//
// Do not depend on generated suffixes such as MarkdownRoot-*.
// ============================================================

const RESPONSE_TEXT_SELECTOR = [
  '[data-content-search-unit-key$=":assistant"] [data-markdown-text-style="assistant-message"]',
  '[data-markdown-text-style="assistant-message"]',
  '[class*="MarkdownRoot"]',
  '[class*="markdown" i]',
  "p",
  "pre",
  "blockquote",
  "li",
  "table"
].join(",");

// ============================================================
// Utilities
// ============================================================

function isVisible(element) {
  if (
    !element ||
    !element.isConnected
  ) {
    return false;
  }

  const style =
    window.getComputedStyle(
      element
    );

  if (
    style.display === "none" ||
    style.visibility === "hidden"
  ) {
    return false;
  }

  const rect =
    element.getBoundingClientRect();

  return (
    rect.width > 0 &&
    rect.height > 0
  );
}

function isIgnoredElement(element) {
  if (!element) {
    return true;
  }

  // ----------------------------------------------------------
  // Ignore user messages
  // ----------------------------------------------------------

  if (
    element.closest(
      [
        '[data-content-search-unit-key$=":user"]',
        '[data-user-message-bubble="true"]',
        '[class*="bg-user-message"]',
        '[class*="text-user-message"]'
      ].join(",")
    )
  ) {
    return true;
  }

  // ----------------------------------------------------------
  // Ignore accessibility-only elements
  // ----------------------------------------------------------

  if (
    element.closest(
      ".sr-only"
    )
  ) {
    return true;
  }

  // ----------------------------------------------------------
  // Ignore composer / application chrome
  // ----------------------------------------------------------

  return Boolean(
    element.closest(
      [
        "form",
        "nav",
        "aside",
        "header",
        "footer",
        "button",
        "textarea",
        "input",
        "[contenteditable='true']"
      ].join(",")
    )
  );
}

function normalizeText(value) {
  return String(
    value || ""
  )
    .replace(/\u200b/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

// ============================================================
// Markdown helpers
// ============================================================

function isMarkdownRoot(element) {
  if (!element) {
    return false;
  }

  return element.matches(
    [
      '[data-markdown-text-style="assistant-message"]',
      '[class*="MarkdownRoot"]',
      '[class*="markdown" i]'
    ].join(",")
  );
}

function hasMarkdownParent(element) {
  if (
    !element ||
    !element.parentElement
  ) {
    return false;
  }

  return Boolean(
    element.parentElement.closest(
      [
        '[data-markdown-text-style="assistant-message"]',
        '[class*="MarkdownRoot"]',
        '[class*="markdown" i]'
      ].join(",")
    )
  );
}

// ============================================================
// Candidate extraction
// ============================================================

function getTextCandidates(root) {
  if (!root) {
    return [];
  }

  const result = [];
  const seen = new Set();

  const elements =
    Array.from(
      root.querySelectorAll(
        RESPONSE_TEXT_SELECTOR
      )
    );

  for (const element of elements) {
    if (
      !isVisible(element) ||
      isIgnoredElement(element)
    ) {
      continue;
    }

    /*
     * Important:
     *
     * Do not use innerText here.
     *
     * ChatGPT has already rendered Markdown into DOM.
     * getElementMarkdown() converts that rendered DOM back
     * into Markdown before Browser Chat sends it to Codex.
     */
    const text =
      normalizeText(
        getElementMarkdown(
          element
        )
      );

    if (
      !text ||
      seen.has(text)
    ) {
      continue;
    }

    // --------------------------------------------------------
    // Prefer complete assistant Markdown root over nested
    // P / PRE / LI / TABLE candidates.
    // --------------------------------------------------------

    if (
      !isMarkdownRoot(element) &&
      hasMarkdownParent(element)
    ) {
      continue;
    }

    seen.add(text);

    result.push({
      element,
      text
    });
  }

  return result;
}

// ============================================================
// Response observer
// ============================================================

export class ChatGPTResponseObserver {
  constructor(options = {}) {
    this.timeoutMs =
      options.timeoutMs ??
      DEFAULT_TIMEOUT_MS;

    this.settleMs =
      options.settleMs ??
      DEFAULT_SETTLE_MS;

    this.pollIntervalMs =
      options.pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS;

    this.observer = null;
    this.pollTimer = null;
    this.timeoutTimer = null;
    this.settleTimer = null;

    this.running = false;
    this.completed = false;
    this.started = false;

    this.requestId = null;
    this.agentId = null;
    this.startedAt = null;

    this.root = null;

    this.baselineTexts =
      new Set();

    this.responseElement =
      null;

    this.lastText =
      "";

    this.sequence =
      0;

    this.callbacks = {};
  }

  // ==========================================================
  // Snapshot
  // ==========================================================

  captureSnapshot() {
    const root =
      getConversationRoot();

    const candidates =
      getTextCandidates(
        root
      );

    return {
      texts:
        candidates.map(
          (item) =>
            item.text
        ),

      capturedAt:
        Date.now()
    };
  }

  // ==========================================================
  // Start
  // ==========================================================

  start({
    requestId,
    agentId,
    snapshot = null,
    timeoutMs = null,
    onStarted = null,
    onDelta = null,
    onCompleted = null,
    onError = null
  }) {
    if (this.running) {
      throw new Error(
        "Response observer is already running"
      );
    }

    if (!requestId) {
      throw new Error(
        "requestId is required"
      );
    }

    if (!agentId) {
      throw new Error(
        "agentId is required"
      );
    }

    this.requestId =
      requestId;

    this.agentId =
      agentId;

    this.startedAt =
      Date.now();

    this.started =
      false;

    this.completed =
      false;

    this.running =
      true;

    this.responseElement =
      null;

    this.lastText =
      "";

    this.sequence =
      0;

    this.callbacks = {
      onStarted,
      onDelta,
      onCompleted,
      onError
    };

    this.root =
      getConversationRoot();

    if (!this.root) {
      this._fail(
        new Error(
          "ChatGPT conversation root not found"
        )
      );

      return;
    }

    const baseline =
      Array.isArray(
        snapshot?.texts
      )
        ? snapshot.texts
        : getTextCandidates(
            this.root
          ).map(
            (item) =>
              item.text
          );

    this.baselineTexts =
      new Set(
        baseline
          .map(
            normalizeText
          )
          .filter(Boolean)
      );

    console.log(
      "[ChatGPTResponseObserver] Started:",
      {
        requestId,
        agentId,
        baselineTextCount:
          this.baselineTexts.size
      }
    );

    // --------------------------------------------------------
    // Mutation observer
    // --------------------------------------------------------

    this.observer =
      new MutationObserver(
        () =>
          this._check()
      );

    this.observer.observe(
      this.root,
      {
        childList: true,
        subtree: true,
        characterData: true
      }
    );

    // --------------------------------------------------------
    // Poll fallback
    // --------------------------------------------------------

    this.pollTimer =
      setInterval(
        () =>
          this._check(),
        this.pollIntervalMs
      );

    // --------------------------------------------------------
    // Overall timeout
    // --------------------------------------------------------

    const effectiveTimeout =
      timeoutMs ??
      this.timeoutMs;

    this.timeoutTimer =
      setTimeout(
        () => {
          this._fail(
            new Error(
              `ChatGPT response timeout after ${effectiveTimeout} ms`
            )
          );
        },
        effectiveTimeout
      );

    // Generation may already have started.
    this._check();
  }

  // ==========================================================
  // Main check
  // ==========================================================

  _check() {
    if (
      !this.running ||
      this.completed
    ) {
      return;
    }

    try {
      const root =
        this.root ||
        getConversationRoot();

      const candidates =
        getTextCandidates(
          root
        );

      // ------------------------------------------------------
      // DOM diff
      // ------------------------------------------------------

      const fresh =
        candidates.filter(
          (item) =>
            item.text &&
            !this.baselineTexts.has(
              item.text
            )
        );

      // ------------------------------------------------------
      // Stop button = strong generation signal
      // ------------------------------------------------------

      if (
        findStopButton()
      ) {
        this._markStarted();
      }

      if (
        fresh.length === 0
      ) {
        return;
      }

      // ------------------------------------------------------
      // Prefer semantic/Markdown assistant root.
      //
      // This avoids generic UI/accessibility text being
      // selected as the assistant response.
      // ------------------------------------------------------

      const markdownCandidates =
        fresh.filter(
          (item) =>
            isMarkdownRoot(
              item.element
            )
        );

      const candidate =
        markdownCandidates.length > 0
          ? markdownCandidates[
              markdownCandidates.length - 1
            ]
          : fresh[
              fresh.length - 1
            ];

      if (
        !candidate ||
        !candidate.element
      ) {
        return;
      }

      /*
       * React may replace the assistant DOM element while
       * generation is in progress. Always accept the latest
       * matching candidate rather than permanently pinning
       * the first DOM node.
       */
      if (
        !this.responseElement ||
        !this.responseElement.isConnected ||
        this.responseElement !==
          candidate.element
      ) {
        this.responseElement =
          candidate.element;
      }

      /*
       * Re-read current DOM as Markdown.
       *
       * candidate.text is only a fallback because the DOM may
       * have changed since getTextCandidates() was called.
       */
      const text =
        normalizeText(
          getElementMarkdown(
            candidate.element
          ) ||
          candidate.text
        );

      if (!text) {
        return;
      }

      if (
        text !==
        this.lastText
      ) {
        this._handleTextChange(
          text
        );
      }

      this._evaluateCompletion(
        text
      );

    } catch (error) {
      console.error(
        "[ChatGPTResponseObserver] Check failed:",
        error
      );
    }
  }

  // ==========================================================
  // Started
  // ==========================================================

  _markStarted() {
    if (this.started) {
      return;
    }

    this.started =
      true;

    console.log(
      "[ChatGPTResponseObserver] Generation started:",
      this.requestId
    );

    this._safeCallback(
      "onStarted",
      {
        requestId:
          this.requestId,

        agentId:
          this.agentId
      }
    );
  }

  // ==========================================================
  // Text / Markdown change
  // ==========================================================

  _handleTextChange(text) {
    this._markStarted();

    const previous =
      this.lastText;

    this.lastText =
      text;

    /*
     * Markdown changed:
     * restart stability window.
     */
    this._clearSettleTimer();

    // --------------------------------------------------------
    // Normal streaming append
    // --------------------------------------------------------

    if (
      text.startsWith(
        previous
      )
    ) {
      const delta =
        text.slice(
          previous.length
        );

      if (delta) {
        this._emitDelta(
          delta,
          text
        );
      }

      this._scheduleSettleCheck();

      return;
    }

    // --------------------------------------------------------
    // React or Markdown serializer rewrote the response.
    //
    // Examples:
    // - React replaced a DOM node
    // - paragraph became list/table
    // - code block changed structure during streaming
    //
    // Send a replacement snapshot instead of calculating an
    // invalid append-only delta.
    // --------------------------------------------------------

    if (text) {
      this.sequence++;

      this._safeCallback(
        "onDelta",
        {
          requestId:
            this.requestId,

          agentId:
            this.agentId,

          seq:
            this.sequence,

          delta:
            text,

          fullText:
            text,

          replace:
            true
        }
      );
    }

    this._scheduleSettleCheck();
  }

  // ==========================================================
  // Delta
  // ==========================================================

  _emitDelta(
    delta,
    fullText
  ) {
    this.sequence++;

    this._safeCallback(
      "onDelta",
      {
        requestId:
          this.requestId,

        agentId:
          this.agentId,

        seq:
          this.sequence,

        delta,

        fullText,

        replace:
          false
      }
    );
  }

  // ==========================================================
  // Completion detection
  // ==========================================================

  _evaluateCompletion(text) {
    if (
      !this.started ||
      !text
    ) {
      return;
    }

    /*
     * Stop button means ChatGPT is still generating.
     */
    if (
      findStopButton()
    ) {
      this._clearSettleTimer();

      return;
    }

    /*
     * Stop button disappeared.
     *
     * Do not complete immediately because React may still be
     * committing the final Markdown DOM.
     */
    this._scheduleSettleCheck();
  }

  // ==========================================================
  // Stable Markdown
  // ==========================================================

  _scheduleSettleCheck() {
    if (
      !this.running ||
      !this.started ||
      !this.lastText
    ) {
      return;
    }

    /*
     * Polling sees the same response every 250 ms.
     * Do NOT reset the timer for unchanged Markdown.
     */
    if (
      this.settleTimer
    ) {
      return;
    }

    const expectedText =
      this.lastText;

    this.settleTimer =
      setTimeout(
        () => {
          this.settleTimer =
            null;

          if (
            !this.running ||
            this.completed
          ) {
            return;
          }

          /*
           * ChatGPT started generating again.
           */
          if (
            findStopButton()
          ) {
            return;
          }

          /*
           * Markdown changed during settle window.
           */
          if (
            this.lastText !==
            expectedText
          ) {
            this._scheduleSettleCheck();

            return;
          }

          /*
           * Re-read DOM once more before completion.
           *
           * This is particularly important for:
           * - long responses
           * - code blocks
           * - tables
           * - React DOM replacement
           */
          this._check();

          if (
            !this.running ||
            this.completed
          ) {
            return;
          }

          if (
            this.lastText !==
            expectedText
          ) {
            this._scheduleSettleCheck();

            return;
          }

          this._complete(
            this.lastText
          );
        },
        this.settleMs
      );
  }

  // ==========================================================
  // Complete
  // ==========================================================

  _complete(content) {
    if (
      !this.running ||
      this.completed
    ) {
      return;
    }

    this.completed =
      true;

    const durationMs =
      Date.now() -
      this.startedAt;

    const payload = {
      requestId:
        this.requestId,

      agentId:
        this.agentId,

      content,

      durationMs,

      sequence:
        this.sequence
    };

    console.log(
      "[ChatGPTResponseObserver] Completed:",
      {
        requestId:
          this.requestId,

        durationMs,

        length:
          content.length
      }
    );

    this._cleanup();

    this._safeCallback(
      "onCompleted",
      payload
    );
  }

  // ==========================================================
  // Error
  // ==========================================================

  _fail(error) {
    if (
      !this.running ||
      this.completed
    ) {
      return;
    }

    console.error(
      "[ChatGPTResponseObserver] Failed:",
      this.requestId,
      error
    );

    const payload = {
      requestId:
        this.requestId,

      agentId:
        this.agentId,

      error
    };

    this._cleanup();

    this._safeCallback(
      "onError",
      payload
    );
  }

  // ==========================================================
  // Stop
  // ==========================================================

  stop() {
    if (
      !this.running
    ) {
      return;
    }

    console.log(
      "[ChatGPTResponseObserver] Stopped:",
      this.requestId
    );

    this._cleanup();
  }

  // ==========================================================
  // Status
  // ==========================================================

  isRunning() {
    return this.running;
  }

  getStatus() {
    return {
      running:
        this.running,

      started:
        this.started,

      completed:
        this.completed,

      requestId:
        this.requestId,

      agentId:
        this.agentId,

      sequence:
        this.sequence,

      responseLength:
        this.lastText.length,

      startedAt:
        this.startedAt,

      baselineTextCount:
        this.baselineTexts.size
    };
  }

  // ==========================================================
  // Cleanup
  // ==========================================================

  _cleanup() {
    if (
      this.observer
    ) {
      this.observer.disconnect();

      this.observer =
        null;
    }

    if (
      this.pollTimer
    ) {
      clearInterval(
        this.pollTimer
      );

      this.pollTimer =
        null;
    }

    if (
      this.timeoutTimer
    ) {
      clearTimeout(
        this.timeoutTimer
      );

      this.timeoutTimer =
        null;
    }

    this._clearSettleTimer();

    this.running =
      false;
  }

  _clearSettleTimer() {
    if (
      !this.settleTimer
    ) {
      return;
    }

    clearTimeout(
      this.settleTimer
    );

    this.settleTimer =
      null;
  }

  // ==========================================================
  // Safe callback
  // ==========================================================

  _safeCallback(
    name,
    payload
  ) {
    const callback =
      this.callbacks[
        name
      ];

    if (
      typeof callback !==
      "function"
    ) {
      return;
    }

    try {
      callback(
        payload
      );
    } catch (error) {
      console.error(
        `[ChatGPTResponseObserver] ${name} callback failed:`,
        error
      );
    }
  }
}