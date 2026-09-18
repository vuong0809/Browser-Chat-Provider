// src/background/heartbeat.js

import {
  HEARTBEAT_INTERVAL_MS
} from "../protocol/constants.js";

import {
  createHeartbeat
} from "../protocol/messages.js";


// ============================================================
// Heartbeat Manager
// ============================================================

export class HeartbeatManager {

  constructor({
    bridgeId,
    send,
    intervalMs = HEARTBEAT_INTERVAL_MS
  }) {

    if (
      typeof bridgeId !== "string" ||
      !bridgeId.trim()
    ) {
      throw new Error(
        "HeartbeatManager requires bridgeId"
      );
    }

    if (typeof send !== "function") {
      throw new Error(
        "HeartbeatManager requires send function"
      );
    }

    if (
      !Number.isFinite(intervalMs) ||
      intervalMs < 1000
    ) {
      throw new Error(
        "Heartbeat interval must be >= 1000 ms"
      );
    }

    this.bridgeId =
      bridgeId.trim();

    this.send =
      send;

    this.intervalMs =
      intervalMs;

    this.timer =
      null;

    this.running =
      false;

    this.sequence =
      0;

    this.lastSentAt =
      null;
  }


  // ==========================================================
  // Start
  // ==========================================================

  start() {

    if (this.running) {
      return;
    }

    this.running =
      true;

    console.log(
      "[Heartbeat] Started:",
      this.bridgeId,
      `interval=${this.intervalMs}ms`
    );


    /*
     * Send the first heartbeat immediately.
     *
     * Do not wait one full interval after the WebSocket
     * connection becomes ready.
     */
    this._sendHeartbeat();


    this.timer =
      setInterval(
        () => {
          this._sendHeartbeat();
        },
        this.intervalMs
      );
  }


  // ==========================================================
  // Stop
  // ==========================================================

  stop() {

    if (this.timer) {

      clearInterval(
        this.timer
      );

      this.timer =
        null;
    }


    if (this.running) {

      console.log(
        "[Heartbeat] Stopped:",
        this.bridgeId
      );
    }


    this.running =
      false;
  }


  // ==========================================================
  // Restart
  // ==========================================================

  restart() {

    this.stop();

    this.start();
  }


  // ==========================================================
  // Manual heartbeat
  // ==========================================================

  pulse() {

    if (!this.running) {
      return false;
    }

    return this._sendHeartbeat();
  }


  // ==========================================================
  // Update bridge ID
  // ==========================================================

  setBridgeId(bridgeId) {

    if (
      typeof bridgeId !== "string" ||
      !bridgeId.trim()
    ) {

      throw new Error(
        "Invalid bridgeId"
      );
    }


    this.bridgeId =
      bridgeId.trim();
  }


  // ==========================================================
  // Update interval
  // ==========================================================

  setIntervalMs(intervalMs) {

    if (
      !Number.isFinite(intervalMs) ||
      intervalMs < 1000
    ) {

      throw new Error(
        "Heartbeat interval must be >= 1000 ms"
      );
    }


    if (
      this.intervalMs === intervalMs
    ) {
      return;
    }


    this.intervalMs =
      intervalMs;


    if (this.running) {
      this.restart();
    }
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

      bridgeId:
        this.bridgeId,

      intervalMs:
        this.intervalMs,

      sequence:
        this.sequence,

      lastSentAt:
        this.lastSentAt
    };
  }


  // ==========================================================
  // Internal heartbeat
  // ==========================================================

  _sendHeartbeat() {

    if (!this.running) {
      return false;
    }


    try {

      const message =
        createHeartbeat(
          this.bridgeId
        );


      /*
       * Additional information is useful for diagnostics.
       *
       * createHeartbeat() already creates:
       *
       * {
       *   v,
       *   type: "event",
       *   method: "bridge.heartbeat",
       *   ...
       * }
       */

      this.sequence++;


      message.payload.sequence =
        this.sequence;


      message.payload.sentAt =
        Date.now();


      const result =
        this.send(message);


      /*
       * WebSocketManager.send() returns:
       *
       * true  -> sent immediately
       * false -> queued / unavailable
       */

      if (result === true) {

        this.lastSentAt =
          Date.now();

        return true;
      }


      console.debug(
        "[Heartbeat] Heartbeat not sent immediately"
      );


      return false;

    } catch (error) {

      console.error(
        "[Heartbeat] Send failed:",
        error
      );

      return false;
    }
  }
}