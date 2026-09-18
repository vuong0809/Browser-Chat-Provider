// src/background/websocket.js

import {
  DEFAULT_WS_URL,
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  WS_READY_STATE
} from "../protocol/constants.js";

import {
  serializeMessage
} from "../protocol/messages.js";

import {
  parseAndValidateMessage
} from "../protocol/validator.js";


// ============================================================
// WebSocket Manager
// ============================================================

export class WebSocketManager {

  constructor(options = {}) {
    this.url =
      options.url ||
      DEFAULT_WS_URL;

    this.socket = null;

    this.shouldReconnect = true;

    this.reconnectTimer = null;

    this.reconnectAttempts = 0;

    this.reconnectDelay =
      RECONNECT_INITIAL_DELAY_MS;

    this.messageQueue = [];

    this.maxQueueSize =
      options.maxQueueSize || 100;


    // --------------------------------------------------------
    // Event handlers
    // --------------------------------------------------------

    this.onOpen =
      options.onOpen || null;

    this.onClose =
      options.onClose || null;

    this.onMessage =
      options.onMessage || null;

    this.onError =
      options.onError || null;

    this.onStateChange =
      options.onStateChange || null;
  }


  // ==========================================================
  // Connection
  // ==========================================================

  connect() {

    if (
      this.socket &&
      (
        this.socket.readyState === WS_READY_STATE.CONNECTING ||
        this.socket.readyState === WS_READY_STATE.OPEN
      )
    ) {
      return;
    }

    this.shouldReconnect = true;

    this._clearReconnectTimer();

    console.log(
      "[BrowserChatBridge] Connecting:",
      this.url
    );

    this._emitStateChange("connecting");

    try {

      this.socket = new WebSocket(
        this.url
      );

    } catch (error) {

      console.error(
        "[BrowserChatBridge] WebSocket creation failed:",
        error
      );

      this._emitError(error);

      this._scheduleReconnect();

      return;
    }


    this.socket.addEventListener(
      "open",
      (event) => {
        this._handleOpen(event);
      }
    );


    this.socket.addEventListener(
      "message",
      (event) => {
        this._handleMessage(event);
      }
    );


    this.socket.addEventListener(
      "close",
      (event) => {
        this._handleClose(event);
      }
    );


    this.socket.addEventListener(
      "error",
      (event) => {
        this._handleError(event);
      }
    );
  }


  // ==========================================================
  // Disconnect
  // ==========================================================

  disconnect() {

    this.shouldReconnect = false;

    this._clearReconnectTimer();

    if (!this.socket) {
      return;
    }

    console.log(
      "[BrowserChatBridge] Disconnecting"
    );

    try {

      this.socket.close(
        1000,
        "Extension disconnected"
      );

    } catch (error) {

      console.warn(
        "[BrowserChatBridge] Error while closing WebSocket:",
        error
      );
    }

    this.socket = null;

    this._emitStateChange(
      "disconnected"
    );
  }


  // ==========================================================
  // Send
  // ==========================================================

  send(message) {

    let serialized;

    try {

      serialized =
        serializeMessage(message);

    } catch (error) {

      console.error(
        "[BrowserChatBridge] Failed to serialize message:",
        error
      );

      this._emitError(error);

      return false;
    }


    // --------------------------------------------------------
    // Socket ready
    // --------------------------------------------------------

    if (this.isConnected()) {

      try {

        this.socket.send(
          serialized
        );

        return true;

      } catch (error) {

        console.error(
          "[BrowserChatBridge] Send failed:",
          error
        );

        this._emitError(error);

        this._enqueue(serialized);

        return false;
      }
    }


    // --------------------------------------------------------
    // Socket unavailable
    // --------------------------------------------------------

    this._enqueue(serialized);

    return false;
  }


  // ==========================================================
  // Connection state
  // ==========================================================

  isConnected() {

    return (
      this.socket !== null &&
      this.socket.readyState === WS_READY_STATE.OPEN
    );
  }


  getReadyState() {

    if (!this.socket) {
      return WS_READY_STATE.CLOSED;
    }

    return this.socket.readyState;
  }


  // ==========================================================
  // URL
  // ==========================================================

  setUrl(url) {

    if (
      typeof url !== "string" ||
      !url.trim()
    ) {
      throw new Error(
        "Invalid WebSocket URL"
      );
    }

    const normalizedUrl =
      url.trim();

    if (
      !normalizedUrl.startsWith("ws://") &&
      !normalizedUrl.startsWith("wss://")
    ) {
      throw new Error(
        "WebSocket URL must start with ws:// or wss://"
      );
    }


    if (normalizedUrl === this.url) {
      return;
    }


    this.url =
      normalizedUrl;


    // --------------------------------------------------------
    // Reconnect using new URL
    // --------------------------------------------------------

    if (this.socket) {

      this.disconnect();

      this.shouldReconnect = true;

      this.connect();
    }
  }


  // ==========================================================
  // Open
  // ==========================================================

  _handleOpen(event) {

    console.log(
      "[BrowserChatBridge] Connected:",
      this.url
    );


    // Reset reconnect state
    this.reconnectAttempts = 0;

    this.reconnectDelay =
      RECONNECT_INITIAL_DELAY_MS;


    this._emitStateChange(
      "connected"
    );


    // Flush messages waiting while disconnected
    this._flushQueue();


    if (
      typeof this.onOpen === "function"
    ) {

      try {

        this.onOpen(event);

      } catch (error) {

        console.error(
          "[BrowserChatBridge] onOpen handler failed:",
          error
        );
      }
    }
  }


  // ==========================================================
  // Incoming message
  // ==========================================================

  _handleMessage(event) {

    const raw =
      event.data;


    if (typeof raw !== "string") {

      console.warn(
        "[BrowserChatBridge] Ignoring non-text WebSocket message"
      );

      return;
    }


    const result =
      parseAndValidateMessage(raw);


    if (!result.valid) {

      console.warn(
        "[BrowserChatBridge] Invalid protocol message:",
        result.errors
      );

      return;
    }


    const message =
      result.message;


    if (
      typeof this.onMessage === "function"
    ) {

      try {

        this.onMessage(
          message
        );

      } catch (error) {

        console.error(
          "[BrowserChatBridge] onMessage handler failed:",
          error
        );

        this._emitError(error);
      }
    }
  }


  // ==========================================================
  // Close
  // ==========================================================

  _handleClose(event) {

    console.warn(
      "[BrowserChatBridge] Connection closed:",
      {
        code: event.code,
        reason: event.reason,
        clean: event.wasClean
      }
    );


    this.socket = null;


    this._emitStateChange(
      "disconnected"
    );


    if (
      typeof this.onClose === "function"
    ) {

      try {

        this.onClose(event);

      } catch (error) {

        console.error(
          "[BrowserChatBridge] onClose handler failed:",
          error
        );
      }
    }


    if (this.shouldReconnect) {

      this._scheduleReconnect();
    }
  }


  // ==========================================================
  // Error
  // ==========================================================

  _handleError(event) {

    console.error(
      "[BrowserChatBridge] WebSocket error:",
      event
    );

    this._emitError(event);

    /*
     * Do not reconnect here.
     *
     * Browsers normally emit "close" after "error".
     * Reconnecting here as well could create multiple
     * reconnect timers.
     */
  }


  // ==========================================================
  // Reconnect
  // ==========================================================

  _scheduleReconnect() {

    if (!this.shouldReconnect) {
      return;
    }


    if (this.reconnectTimer) {
      return;
    }


    const delay =
      this._calculateReconnectDelay();


    console.log(
      `[BrowserChatBridge] Reconnecting in ${delay} ms`
    );


    this._emitStateChange(
      "reconnecting"
    );


    this.reconnectTimer =
      setTimeout(
        () => {

          this.reconnectTimer = null;

          this.reconnectAttempts++;

          this.connect();

        },
        delay
      );
  }


  _calculateReconnectDelay() {

    const exponentialDelay =
      Math.min(
        RECONNECT_INITIAL_DELAY_MS *
          Math.pow(
            2,
            this.reconnectAttempts
          ),

        RECONNECT_MAX_DELAY_MS
      );


    /*
     * Small random jitter prevents reconnect storms
     * if multiple browser instances reconnect together.
     */
    const jitter =
      Math.floor(
        Math.random() * 500
      );


    return (
      exponentialDelay +
      jitter
    );
  }


  _clearReconnectTimer() {

    if (!this.reconnectTimer) {
      return;
    }


    clearTimeout(
      this.reconnectTimer
    );


    this.reconnectTimer = null;
  }


  // ==========================================================
  // Queue
  // ==========================================================

  _enqueue(serializedMessage) {

    if (
      this.messageQueue.length >=
      this.maxQueueSize
    ) {

      const dropped =
        this.messageQueue.shift();

      console.warn(
        "[BrowserChatBridge] Queue full. Dropping oldest message:",
        dropped
      );
    }


    this.messageQueue.push(
      serializedMessage
    );


    console.log(
      "[BrowserChatBridge] Message queued:",
      this.messageQueue.length
    );
  }


  _flushQueue() {

    if (!this.isConnected()) {
      return;
    }


    if (
      this.messageQueue.length === 0
    ) {
      return;
    }


    console.log(
      "[BrowserChatBridge] Flushing queue:",
      this.messageQueue.length
    );


    while (
      this.messageQueue.length > 0 &&
      this.isConnected()
    ) {

      const message =
        this.messageQueue.shift();


      try {

        this.socket.send(
          message
        );

      } catch (error) {

        console.error(
          "[BrowserChatBridge] Queue flush failed:",
          error
        );


        /*
         * Put failed message back at the beginning.
         */
        this.messageQueue.unshift(
          message
        );


        this._emitError(error);

        break;
      }
    }
  }


  // ==========================================================
  // Events
  // ==========================================================

  _emitStateChange(state) {

    if (
      typeof this.onStateChange !==
      "function"
    ) {
      return;
    }


    try {

      this.onStateChange(state);

    } catch (error) {

      console.error(
        "[BrowserChatBridge] onStateChange handler failed:",
        error
      );
    }
  }


  _emitError(error) {

    if (
      typeof this.onError !==
      "function"
    ) {
      return;
    }


    try {

      this.onError(error);

    } catch (handlerError) {

      console.error(
        "[BrowserChatBridge] onError handler failed:",
        handlerError
      );
    }
  }
}