// src/providers/chatgpt/ChatGPTAdapter.js

import {
  PROVIDER
} from "../../protocol/constants.js";

import {
  ChatProviderAdapter
} from "../base/ChatProviderAdapter.js";

import {
  findComposer,
  findStopButton,
  getAssistantMessages
} from "./selectors.js";

import {
  setComposerText,
  submitComposer,
  sendComposerMessage
} from "./composer.js";

import {
  ChatGPTResponseObserver
} from "./response-observer.js";



// ============================================================
// ChatGPT Adapter
// ============================================================

export class ChatGPTAdapter
  extends ChatProviderAdapter {

  constructor(options = {}) {

    super(options);


    this.responseObserver =
      new ChatGPTResponseObserver({
        timeoutMs:
          options.timeoutMs,

        settleMs:
          options.settleMs,

        pollIntervalMs:
          options.pollIntervalMs
      });


    this.responseCallbacks =
      null;


    this.lastSnapshot =
      null;


    this.lastSubmitAt =
      null;
  }


  // ==========================================================
  // Provider metadata
  // ==========================================================

  get providerId() {

    return PROVIDER.CHATGPT;
  }


  get providerName() {

    return "ChatGPT";
  }


  // ==========================================================
  // Initialization
  // ==========================================================

  async initialize() {

    if (this.initialized) {
      return;
    }


    if (!this.detect()) {

      throw new Error(
        "Current page is not ChatGPT"
      );
    }


    this.initialized =
      true;


    console.log(
      "[ChatGPTAdapter] Initialized",
      {
        conversationId:
          this.getConversationId(),

        title:
          this.getTitle()
      }
    );
  }


  async destroy() {

    this.stopObservingResponse();


    this.responseCallbacks =
      null;

    this.lastSnapshot =
      null;

    this.lastSubmitAt =
      null;


    await super.destroy();


    console.log(
      "[ChatGPTAdapter] Destroyed"
    );
  }


  // ==========================================================
  // Detection
  // ==========================================================

  detect() {

    return (
      window.location.hostname ===
      "chatgpt.com"
    );
  }


  // ==========================================================
  // Ready
  // ==========================================================

  isReady() {

    if (!this.detect()) {
      return false;
    }


    if (!findComposer()) {
      return false;
    }


    /*
     * A visible Stop button means ChatGPT is already
     * generating something in this conversation.
     *
     * Do not inject another request.
     */
    if (findStopButton()) {
      return false;
    }


    return true;
  }


  // ==========================================================
  // Conversation ID
  // ==========================================================

  getConversationId() {

    try {

      /*
       * Typical ChatGPT conversation URL:
       *
       * https://chatgpt.com/c/<conversation-id>
       */

      const match =
        window.location.pathname.match(
          /^\/c\/([^/?#]+)/
        );


      if (
        match &&
        match[1]
      ) {

        return decodeURIComponent(
          match[1]
        );
      }


      /*
       * A new conversation may initially be:
       *
       * https://chatgpt.com/
       *
       * There is no conversation ID until the first message
       * causes ChatGPT to create the conversation.
       */

      return null;

    } catch {

      return null;
    }
  }


  // ==========================================================
  // Title
  // ==========================================================

  getTitle() {

    const title =
      document.title?.trim();


    if (!title) {
      return null;
    }


    /*
     * Remove the common ChatGPT suffix when present.
     */

    return title
      .replace(
        /\s*[-–—]\s*ChatGPT\s*$/i,
        ""
      )
      .trim() || title;
  }


  // ==========================================================
  // Composer
  // ==========================================================

  findComposer() {

    return findComposer();
  }


  async setComposerText(text) {

    return setComposerText(
      text,
      {
        timeout:
          this.options.composerTimeoutMs ??
          10_000
      }
    );
  }


  async submit() {

    const result =
      await submitComposer({
        timeout:
          this.options.composerTimeoutMs ??
          10_000
      });


    this.lastSubmitAt =
      Date.now();


    return result;
  }


  // ==========================================================
  // Send message
  // ==========================================================
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
        `ChatGPT is already processing request ${this.currentRequestId}`
      );
    }


    if (!this.detect()) {

      throw new Error(
        "Current page is not ChatGPT"
      );
    }


    if (!this.isReady()) {

      throw new Error(
        "ChatGPT is not ready"
      );
    }


    // --------------------------------------------------------
    // Lock adapter
    // --------------------------------------------------------

    this.currentRequestId =
      requestId;

    this.currentAgentId =
      agentId;


    // --------------------------------------------------------
    // Snapshot BEFORE submit
    // --------------------------------------------------------

    this.lastSnapshot =
      this.responseObserver.captureSnapshot();


    console.log(
      "[ChatGPTAdapter] Sending:",
      {
        requestId,
        agentId,

        assistantCount:
          this.lastSnapshot
            .assistantCount
      }
    );


    try {

      // ------------------------------------------------------
      // Input + Submit
      //
      // ChatGPT uses ProseMirror. Do not use synthetic
      // DOM/paste/input events for the production send path.
      //
      // sendComposerMessage() performs:
      //
      //   Content Script
      //       ↓
      //   chrome.runtime.sendMessage("browser-chat.cdp-input")
      //       ↓
      //   Background Service Worker
      //       ↓
      //   chrome.debugger / CDP
      //       ↓
      //   Runtime.evaluate -> focus ProseMirror
      //   Input.insertText -> native browser input
      //       ↓
      //   submitComposer() -> click Send
      //
      // Therefore do NOT call this.setComposerText() or
      // this.submit() separately here.
      // ------------------------------------------------------

      const submitResult =
        await sendComposerMessage(
          content
        );


      // ------------------------------------------------------
      // Start response observer immediately
      // ------------------------------------------------------

      this._startResponseObserver({
        requestId,
        agentId,
        snapshot:
          this.lastSnapshot,

        options
      });


      return {
        accepted: true,

        requestId,

        agentId,

        provider:
          this.providerId,

        submitMethod:
          submitResult?.method ??
          null,

        submitConfirmation:
          submitResult?.confirmation ??
          null,

        composerCleared:
          submitResult?.composerCleared ??
          null,

        submittedAt:
          this.lastSubmitAt
      };

    } catch (error) {

      console.error(
        "[ChatGPTAdapter] Send failed:",
        error
      );


      this.stopObservingResponse();


      this.clearCurrentRequest(
        requestId
      );


      throw error;
    }
  }


  // ==========================================================
  // Response callbacks
  // ==========================================================

  observeResponse(
    callbacks = {}
  ) {

    this.responseCallbacks = {
      onStarted:
        callbacks.onStarted ??
        null,

      onDelta:
        callbacks.onDelta ??
        null,

      onCompleted:
        callbacks.onCompleted ??
        null,

      onError:
        callbacks.onError ??
        null
    };


    return () => {
      this.responseCallbacks =
        null;
    };
  }


  // ==========================================================
  // Start response observer
  // ==========================================================

  _startResponseObserver({
    requestId,
    agentId,
    snapshot,
    options = {}
  }) {

    if (
      this.responseObserver.isRunning()
    ) {

      this.responseObserver.stop();
    }


    this.responseObserver.start({
      requestId,

      agentId,

      snapshot,

      timeoutMs:
        options.timeout ??
        this.options.timeoutMs ??
        180_000,


      // ------------------------------------------------------
      // Started
      // ------------------------------------------------------

      onStarted:
        (event) => {

          this._emitResponseCallback(
            "onStarted",
            event
          );
        },


      // ------------------------------------------------------
      // Delta
      // ------------------------------------------------------

      onDelta:
        (event) => {

          /*
           * Protect against a late observer event belonging
           * to an older request.
           */

          if (
            this.currentRequestId !==
            event.requestId
          ) {
            return;
          }


          this._emitResponseCallback(
            "onDelta",
            event
          );
        },


      // ------------------------------------------------------
      // Completed
      // ------------------------------------------------------

      onCompleted:
        (event) => {

          if (
            this.currentRequestId !==
            event.requestId
          ) {
            return;
          }


          /*
           * Capture conversation ID AFTER completion.
           *
           * Important for new conversations because the URL
           * may change from:
           *
           * /
           *
           * to:
           *
           * /c/<conversation-id>
           */

          const conversationId =
            this.getConversationId();


          const completedEvent = {
            ...event,

            conversationId,

            title:
              this.getTitle()
          };


          /*
           * Clear state before notifying consumers so the
           * adapter is immediately available for the next
           * request.
           */

          this.clearCurrentRequest(
            event.requestId
          );


          this.lastSnapshot =
            null;


          this._emitResponseCallback(
            "onCompleted",
            completedEvent
          );
        },


      // ------------------------------------------------------
      // Error
      // ------------------------------------------------------

      onError:
        (event) => {

          if (
            this.currentRequestId !==
            event.requestId
          ) {
            return;
          }


          this.clearCurrentRequest(
            event.requestId
          );


          this.lastSnapshot =
            null;


          this._emitResponseCallback(
            "onError",
            event
          );
        }
    });
  }


  // ==========================================================
  // Stop observing
  // ==========================================================

  stopObservingResponse() {

    if (
      this.responseObserver &&
      this.responseObserver.isRunning()
    ) {

      this.responseObserver.stop();
    }
  }

  // ==========================================================
  // Complete externally
  // ==========================================================

  completeCurrentRequest(
    requestId
  ) {

    if (!requestId) {

      return {
        completed: false,
        reason: "request-id-required"
      };
    }


    if (!this.currentRequestId) {

      return {
        completed: false,
        reason: "no-active-request"
      };
    }


    if (
      this.currentRequestId !==
      requestId
    ) {

      return {
        completed: false,
        reason: "request-mismatch",
        activeRequestId:
          this.currentRequestId
      };
    }


    /*
     * Network interception has already captured the authoritative
     * final response.
     *
     * Stop the DOM observer BEFORE clearing the adapter lock so
     * it cannot emit a second completion for the same request.
     */

    this.stopObservingResponse();


    this.clearCurrentRequest(
      requestId
    );


    this.lastSnapshot =
      null;


    console.debug(
      "[ChatGPTAdapter] Completed externally:",
      requestId
    );


    return {
      completed: true,
      requestId
    };
  }

  // ==========================================================
  // Cancel
  // ==========================================================

  async cancel(
    requestId = null
  ) {

    if (!this.currentRequestId) {

      return {
        canceled: false,
        reason: "no-active-request"
      };
    }


    if (
      requestId &&
      requestId !==
      this.currentRequestId
    ) {

      return {
        canceled: false,
        reason: "request-mismatch"
      };
    }


    const activeRequestId =
      this.currentRequestId;


    const stopButton =
      findStopButton();


    if (!stopButton) {

      /*
       * The generation may already have completed while the
       * cancel request was traveling through the bridge.
       */

      this.stopObservingResponse();


      this.clearCurrentRequest(
        activeRequestId
      );


      return {
        canceled: false,
        reason: "stop-button-not-found"
      };
    }


    try {

      stopButton.click();


      /*
       * Wait briefly for ChatGPT to process the click.
       */

      await this.sleep(
        100
      );


      this.stopObservingResponse();


      this.clearCurrentRequest(
        activeRequestId
      );


      console.log(
        "[ChatGPTAdapter] Canceled:",
        activeRequestId
      );


      return {
        canceled: true,
        requestId:
          activeRequestId
      };

    } catch (error) {

      console.error(
        "[ChatGPTAdapter] Cancel failed:",
        error
      );


      throw error;
    }
  }


  // ==========================================================
  // Status
  // ==========================================================

  getStatus() {

    const base =
      super.getStatus();


    return {
      ...base,

      assistantMessages:
        getAssistantMessages().length,

      generating:
        Boolean(
          findStopButton()
        ),

      observer:
        this.responseObserver
          .getStatus(),

      lastSubmitAt:
        this.lastSubmitAt
    };
  }


  // ==========================================================
  // Callback helper
  // ==========================================================

  _emitResponseCallback(
    name,
    event
  ) {

    const callback =
      this.responseCallbacks?.[
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
        event
      );

    } catch (error) {

      console.error(
        `[ChatGPTAdapter] ${name} callback failed:`,
        error
      );
    }
  }
}