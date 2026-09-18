// src/content/network-response-bridge.js

const SOURCE =
  "browser-chat-network";

const ALLOWED_TYPES =
  new Set([
    "network.interceptor.ready",
    "conversation.stream.start",
    "conversation.input",
    "conversation.response.started",
    "conversation.response.delta",
    "conversation.response.completed",
    "conversation.stream.complete",
    "conversation.stream.error"
  ]);


export class NetworkResponseBridge {

  constructor({
    onEvent = null
  } = {}) {

    this.onEvent =
      onEvent;

    this.started =
      false;

    this._handleMessage =
      this._handleMessage.bind(
        this
      );
  }


  // ==========================================================
  // Lifecycle
  // ==========================================================

  start() {

    if (this.started) {
      return;
    }


    window.addEventListener(
      "message",
      this._handleMessage
    );


    this.started =
      true;


    console.log(
      "[NetworkResponseBridge] Started"
    );
  }


  stop() {

    if (!this.started) {
      return;
    }


    window.removeEventListener(
      "message",
      this._handleMessage
    );


    this.started =
      false;


    console.log(
      "[NetworkResponseBridge] Stopped"
    );
  }


  // ==========================================================
  // MAIN world → isolated content script
  // ==========================================================

  _handleMessage(event) {

    /*
     * Only accept messages originating from
     * this exact page/window.
     */

    if (
      event.source !== window
    ) {
      return;
    }


    if (
      event.origin !==
      window.location.origin
    ) {
      return;
    }


    const message =
      event.data;


    if (
      !message ||
      typeof message !==
        "object"
    ) {
      return;
    }


    if (
      message.source !==
      SOURCE
    ) {
      return;
    }


    if (
      message.version !== 1
    ) {
      return;
    }


    if (
      !ALLOWED_TYPES.has(
        message.type
      )
    ) {
      return;
    }


    const normalized = {

      type:
        message.type,

      timestamp:
        Number.isFinite(
          message.timestamp
        )
          ? message.timestamp
          : Date.now(),

      payload:
        message.payload &&
        typeof message.payload ===
          "object"
          ? message.payload
          : {}
    };


    /*
     * Do not log response content here.
     */

    console.log(
      "[NetworkResponseBridge] Event",
      {
        type:
          normalized.type,

        streamId:
          normalized.payload
            ?.streamId ??
          null,

        requestId:
          normalized.payload
            ?.requestId ??
          null,

        messageId:
          normalized.payload
            ?.messageId ??
          null,

        deltaLength:
          typeof normalized
            .payload?.delta ===
            "string"
              ? normalized
                  .payload
                  .delta
                  .length
              : undefined,

        responseLength:
          normalized.payload
            ?.length
      }
    );


    if (
      typeof this.onEvent ===
      "function"
    ) {

      try {

        this.onEvent(
          normalized
        );

      } catch (error) {

        console.error(
          "[NetworkResponseBridge] Event handler failed:",
          error
        );
      }
    }
  }
}