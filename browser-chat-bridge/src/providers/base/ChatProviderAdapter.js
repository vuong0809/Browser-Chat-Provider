// src/providers/base/ChatProviderAdapter.js

/**
 * Base adapter for browser-based AI chat providers.
 *
 * Provider implementations should extend this class.
 *
 * Examples:
 *   ChatGPTAdapter
 *   ClaudeAdapter
 *   GeminiAdapter
 */
export class ChatProviderAdapter {

  constructor(options = {}) {
    this.options = options;

    this.initialized = false;

    this.currentRequestId = null;

    this.currentAgentId = null;
  }


  // ==========================================================
  // Provider metadata
  // ==========================================================

  /**
   * Unique provider identifier.
   *
   * Example:
   *   chatgpt-web
   */
  get providerId() {
    throw new Error(
      "providerId getter must be implemented"
    );
  }


  /**
   * Human-readable provider name.
   *
   * Example:
   *   ChatGPT
   */
  get providerName() {
    return this.providerId;
  }


  // ==========================================================
  // Initialization
  // ==========================================================

  async initialize() {

    if (this.initialized) {
      return;
    }

    this.initialized = true;
  }


  async destroy() {

    this.currentRequestId = null;
    this.currentAgentId = null;

    this.initialized = false;
  }


  // ==========================================================
  // Detection
  // ==========================================================

  /**
   * Check whether this adapter supports the current page.
   */
  detect() {
    throw new Error(
      "detect() must be implemented"
    );
  }


  /**
   * Check whether the chat UI is currently usable.
   */
  isReady() {
    throw new Error(
      "isReady() must be implemented"
    );
  }


  // ==========================================================
  // Conversation metadata
  // ==========================================================

  /**
   * Return provider conversation ID when available.
   */
  getConversationId() {
    return null;
  }


  /**
   * Return current conversation title.
   */
  getTitle() {
    return document.title || null;
  }


  // ==========================================================
  // Composer
  // ==========================================================

  /**
   * Find the prompt composer/input element.
   */
  findComposer() {
    throw new Error(
      "findComposer() must be implemented"
    );
  }


  /**
   * Put text into the provider composer.
   */
  async setComposerText(_text) {
    throw new Error(
      "setComposerText() must be implemented"
    );
  }


  /**
   * Submit the current composer.
   */
  async submit() {
    throw new Error(
      "submit() must be implemented"
    );
  }


  // ==========================================================
  // Chat execution
  // ==========================================================

  /**
   * High-level send operation.
   *
   * Provider implementations may override this method if
   * they need a different sequence.
   */
  async sendMessage({
    requestId,
    agentId,
    content,
    options = {}
  }) {

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

    if (
      typeof content !== "string" ||
      !content.trim()
    ) {
      throw new Error(
        "Message content is required"
      );
    }

    if (this.isBusy()) {
      throw new Error(
        `Provider is already processing request ${this.currentRequestId}`
      );
    }

    if (!this.detect()) {
      throw new Error(
        `${this.providerName} is not detected on the current page`
      );
    }

    if (!this.isReady()) {
      throw new Error(
        `${this.providerName} is not ready`
      );
    }


    this.currentRequestId =
      requestId;

    this.currentAgentId =
      agentId;


    try {

      await this.setComposerText(
        content
      );

      await this.submit();

      return {
        accepted: true,
        requestId,
        agentId,
        options
      };

    } catch (error) {

      this.clearCurrentRequest(
        requestId
      );

      throw error;
    }
  }


  // ==========================================================
  // Response observation
  // ==========================================================

  /**
   * Start observing the provider's response.
   *
   * callbacks:
   *
   * {
   *   onStarted()
   *   onDelta(delta, fullText)
   *   onCompleted(content)
   *   onError(error)
   * }
   */
  observeResponse(_callbacks = {}) {
    throw new Error(
      "observeResponse() must be implemented"
    );
  }


  /**
   * Stop the active response observer.
   */
  stopObservingResponse() {
    // Optional for providers.
  }


  // ==========================================================
  // Cancel
  // ==========================================================

  /**
   * Cancel provider generation.
   */
  async cancel(_requestId = null) {
    throw new Error(
      "cancel() must be implemented"
    );
  }


  // ==========================================================
  // Request state
  // ==========================================================

  isBusy() {
    return Boolean(
      this.currentRequestId
    );
  }


  getCurrentRequest() {

    if (!this.currentRequestId) {
      return null;
    }

    return {
      requestId:
        this.currentRequestId,

      agentId:
        this.currentAgentId
    };
  }


  /**
   * Clear the active request.
   *
   * If requestId is supplied, only clear when it matches the
   * current request. This protects a newer request from a late
   * completion callback belonging to an older request.
   */
  clearCurrentRequest(
    requestId = null
  ) {

    if (
      requestId &&
      this.currentRequestId !==
        requestId
    ) {
      return false;
    }


    this.currentRequestId =
      null;

    this.currentAgentId =
      null;

    return true;
  }


  // ==========================================================
  // Status
  // ==========================================================

  getStatus() {

    return {
      provider:
        this.providerId,

      detected:
        this.detect(),

      ready:
        this.isReady(),

      busy:
        this.isBusy(),

      request:
        this.getCurrentRequest(),

      conversationId:
        this.getConversationId(),

      title:
        this.getTitle()
    };
  }


  // ==========================================================
  // Utilities
  // ==========================================================

  /**
   * Wait until condition() returns a truthy value.
   *
   * Useful because browser chat UIs are SPAs and DOM elements
   * may appear asynchronously.
   */
  async waitFor(
    condition,
    {
      timeout = 10_000,
      interval = 100
    } = {}
  ) {

    const startedAt =
      Date.now();


    while (
      Date.now() - startedAt <
      timeout
    ) {

      let result = null;


      try {
        result =
          await condition();
      } catch {
        result = null;
      }


      if (result) {
        return result;
      }


      await this.sleep(
        interval
      );
    }


    throw new Error(
      `Timeout after ${timeout} ms`
    );
  }


  sleep(ms) {

    return new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          ms
        )
    );
  }
}