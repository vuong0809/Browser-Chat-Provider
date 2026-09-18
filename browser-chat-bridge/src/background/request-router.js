// src/background/request-router.js

import {
  MESSAGE_TYPE,
  METHOD,
  INTERNAL_MESSAGE,
  AGENT_STATUS
} from "../protocol/constants.js";

import {
  createResponse,
  createError,
  createAgentStatus
} from "../protocol/messages.js";


// ============================================================
// Error Codes
// ============================================================

const ERROR_CODE = Object.freeze({
  UNSUPPORTED_MESSAGE_TYPE: "UNSUPPORTED_MESSAGE_TYPE",
  UNSUPPORTED_METHOD: "UNSUPPORTED_METHOD",

  INVALID_REQUEST: "INVALID_REQUEST",

  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_BUSY: "AGENT_BUSY",
  AGENT_OFFLINE: "AGENT_OFFLINE",

  TAB_UNAVAILABLE: "TAB_UNAVAILABLE",
  CONTENT_SCRIPT_UNAVAILABLE: "CONTENT_SCRIPT_UNAVAILABLE",

  REQUEST_NOT_FOUND: "REQUEST_NOT_FOUND",
  REQUEST_MISMATCH: "REQUEST_MISMATCH",

  SEND_FAILED: "SEND_FAILED",
  CANCEL_FAILED: "CANCEL_FAILED",

  INTERNAL_ERROR: "INTERNAL_ERROR"
});


// ============================================================
// Request Router
// ============================================================

export class RequestRouter {

  constructor({
    agentRegistry,
    sendTo9Router
  }) {

    if (!agentRegistry) {
      throw new Error(
        "RequestRouter requires agentRegistry"
      );
    }

    if (typeof sendTo9Router !== "function") {
      throw new Error(
        "RequestRouter requires sendTo9Router function"
      );
    }

    this.agentRegistry =
      agentRegistry;

    this.sendTo9Router =
      sendTo9Router;
  }


  // ==========================================================
  // Main entry
  // ==========================================================

  async handle(message) {

    try {

      switch (message.type) {

        case MESSAGE_TYPE.REQUEST:
          await this._handleRequest(message);
          break;

        case MESSAGE_TYPE.RESPONSE:
          this._handleResponse(message);
          break;

        case MESSAGE_TYPE.EVENT:
          await this._handleEvent(message);
          break;

        case MESSAGE_TYPE.ERROR:
          this._handleRemoteError(message);
          break;

        default:

          this._sendError(
            message.id,
            ERROR_CODE.UNSUPPORTED_MESSAGE_TYPE,
            `Unsupported message type: ${message.type}`
          );
      }

    } catch (error) {

      console.error(
        "[RequestRouter] Unhandled error:",
        error
      );

      this._sendError(
        message?.id ?? null,
        ERROR_CODE.INTERNAL_ERROR,
        error?.message || "Internal request router error"
      );
    }
  }


  // ==========================================================
  // Requests
  // ==========================================================

  async _handleRequest(message) {

    console.log(
      "[RequestRouter] Request:",
      message.method,
      message.id
    );

    switch (message.method) {

      case METHOD.CHAT_SEND:
        await this._handleChatSend(message);
        return;

      case METHOD.CHAT_CANCEL:
        await this._handleChatCancel(message);
        return;

      case METHOD.AGENT_LIST:
        await this._handleAgentList(message);
        return;

      default:

        this._sendError(
          message.id,
          ERROR_CODE.UNSUPPORTED_METHOD,
          `Unsupported request method: ${message.method}`
        );
    }
  }


  // ==========================================================
  // chat.send
  // ==========================================================

  async _handleChatSend(message) {

    const payload =
      message.payload || {};

    const agentId =
      payload.agentId;

    const content =
      payload.message?.content;


    // --------------------------------------------------------
    // Find agent
    // --------------------------------------------------------

    const agent =
      this.agentRegistry.get(agentId);


    if (!agent) {

      this._sendError(
        message.id,
        ERROR_CODE.AGENT_NOT_FOUND,
        `Agent not found: ${agentId}`
      );

      return;
    }


    // --------------------------------------------------------
    // Offline
    // --------------------------------------------------------

    if (
      agent.status ===
      AGENT_STATUS.OFFLINE
    ) {

      this._sendError(
        message.id,
        ERROR_CODE.AGENT_OFFLINE,
        `Agent is offline: ${agentId}`
      );

      return;
    }


    // --------------------------------------------------------
    // Busy
    // --------------------------------------------------------

    if (
      this.agentRegistry.isBusy(agentId)
    ) {

      this._sendError(
        message.id,
        ERROR_CODE.AGENT_BUSY,
        `Agent "${agentId}" is busy`,
        {
          activeRequestId:
            agent.activeRequestId
        }
      );

      return;
    }


    // --------------------------------------------------------
    // Verify tab
    // --------------------------------------------------------

    const tabAvailable =
      await this._isTabAvailable(
        agent.tabId
      );


    if (!tabAvailable) {

      await this.agentRegistry.setStatus(
        agentId,
        AGENT_STATUS.OFFLINE
      );

      this._sendError(
        message.id,
        ERROR_CODE.TAB_UNAVAILABLE,
        `Tab unavailable for agent: ${agentId}`,
        {
          tabId:
            agent.tabId
        }
      );

      return;
    }


    // --------------------------------------------------------
    // Lock agent
    // --------------------------------------------------------

    try {

      await this.agentRegistry.setActiveRequest(
        agentId,
        message.id
      );

    } catch (error) {

      this._sendError(
        message.id,
        ERROR_CODE.AGENT_BUSY,
        error.message
      );

      return;
    }


    // --------------------------------------------------------
    // Send to content script
    // --------------------------------------------------------

    try {

      const response =
        await chrome.tabs.sendMessage(
          agent.tabId,
          {
            type:
              INTERNAL_MESSAGE.CHAT_SEND,

            requestId:
              message.id,

            agentId,

            content,

            options:
              payload.options || {}
          }
        );


      /*
       * Content script should immediately acknowledge
       * that it accepted the request.
       *
       * This is NOT the ChatGPT answer.
       */
      if (
        response &&
        response.accepted === false
      ) {

        throw new Error(
          response.error ||
          "Content script rejected request"
        );
      }


      // ------------------------------------------------------
      // Notify 9Router about state
      // ------------------------------------------------------

      this._send(
        createAgentStatus(
          agentId,
          AGENT_STATUS.SENDING,
          {
            requestId:
              message.id
          }
        )
      );


      console.log(
        "[RequestRouter] chat.send routed:",
        message.id,
        "→",
        agentId,
        "→ tab",
        agent.tabId
      );

    } catch (error) {

      console.error(
        "[RequestRouter] Failed to send to content script:",
        error
      );


      await this.agentRegistry.clearActiveRequest(
        agentId,
        message.id
      );


      this._sendError(
        message.id,
        ERROR_CODE.CONTENT_SCRIPT_UNAVAILABLE,
        `Unable to communicate with agent "${agentId}"`,
        {
          tabId:
            agent.tabId,

          reason:
            error.message
        }
      );
    }
  }


  // ==========================================================
  // chat.cancel
  // ==========================================================

  async _handleChatCancel(message) {

    const payload =
      message.payload || {};

    const requestId =
      payload.requestId;

    const agent =
      this._findAgentByRequestId(
        requestId
      );


    if (!agent) {

      this._sendError(
        message.id,
        ERROR_CODE.REQUEST_NOT_FOUND,
        `Active request not found: ${requestId}`
      );

      return;
    }


    const tabAvailable =
      await this._isTabAvailable(
        agent.tabId
      );


    if (!tabAvailable) {

      await this.agentRegistry.clearActiveRequest(
        agent.agentId,
        requestId
      );

      this._sendError(
        message.id,
        ERROR_CODE.TAB_UNAVAILABLE,
        `Tab unavailable for agent: ${agent.agentId}`
      );

      return;
    }


    try {

      await chrome.tabs.sendMessage(
        agent.tabId,
        {
          type:
            INTERNAL_MESSAGE.CHAT_CANCEL,

          requestId,

          agentId:
            agent.agentId
        }
      );


      await this.agentRegistry.setStatus(
        agent.agentId,
        AGENT_STATUS.CANCELED
      );


      await this.agentRegistry.clearActiveRequest(
        agent.agentId,
        requestId
      );


      this._send(
        createResponse(
          message.id,
          {
            requestId,

            agentId:
              agent.agentId,

            status:
              AGENT_STATUS.CANCELED
          }
        )
      );


      this._send(
        createAgentStatus(
          agent.agentId,
          AGENT_STATUS.IDLE
        )
      );


      console.log(
        "[RequestRouter] Request canceled:",
        requestId
      );

    } catch (error) {

      console.error(
        "[RequestRouter] Cancel failed:",
        error
      );


      this._sendError(
        message.id,
        ERROR_CODE.CANCEL_FAILED,
        `Unable to cancel request: ${requestId}`,
        {
          reason:
            error.message
        }
      );
    }
  }


  // ==========================================================
  // agent.list
  // ==========================================================

  async _handleAgentList(message) {

    const agents =
      this.agentRegistry.list();


    /*
     * Avoid exposing unnecessary internal information
     * to Codex/9Router.
     *
     * tabId is intentionally not included here.
     */
    const result =
      agents.map(
        (agent) => ({
          agentId:
            agent.agentId,

          provider:
            agent.provider,

          conversationId:
            agent.conversationId,

          title:
            agent.title,

          status:
            agent.status,

          capabilities:
            agent.capabilities,

          busy:
            Boolean(
              agent.activeRequestId
            )
        })
      );


    this._send(
      createResponse(
        message.id,
        {
          agents:
            result
        }
      )
    );
  }


  // ==========================================================
  // Responses from 9Router
  // ==========================================================

  _handleResponse(message) {

    /*
     * Most responses from 9Router will eventually be handled
     * by a request manager.
     *
     * For the MVP we only log them.
     */

    console.log(
      "[RequestRouter] Response from 9Router:",
      message.id,
      message.result
    );
  }


  // ==========================================================
  // Events from 9Router
  // ==========================================================

  async _handleEvent(message) {

    console.log(
      "[RequestRouter] Event from 9Router:",
      message.method,
      message.payload
    );

    /*
     * No inbound events are required for the first MVP.
     *
     * Later this can handle:
     *
     * bridge.status
     * configuration updates
     * remote agent metadata
     */
  }


  // ==========================================================
  // Remote error
  // ==========================================================

  _handleRemoteError(message) {

    console.error(
      "[RequestRouter] Error from 9Router:",
      message.error
    );
  }


  // ==========================================================
  // Content Script Events
  // ==========================================================

  /**
   * Called by service-worker.js when the content script reports
   * that ChatGPT has started generating.
   */
  async handleChatStarted({
    requestId,
    agentId
  }) {

    const agent =
      this.agentRegistry.get(agentId);


    if (!agent) {
      return;
    }


    if (
      agent.activeRequestId !==
      requestId
    ) {

      console.warn(
        "[RequestRouter] Ignoring stale CHAT_STARTED:",
        requestId
      );

      return;
    }


    await this.agentRegistry.setStatus(
      agentId,
      AGENT_STATUS.GENERATING
    );


    this._send(
      createAgentStatus(
        agentId,
        AGENT_STATUS.GENERATING,
        {
          requestId
        }
      )
    );
  }


  // ==========================================================
  // Chat delta
  // ==========================================================

  handleChatDelta({
    requestId,
    agentId,
    seq,
    delta
  }) {

    const agent =
      this.agentRegistry.get(agentId);


    if (!agent) {
      return;
    }


    if (
      agent.activeRequestId !==
      requestId
    ) {
      return;
    }


    /*
     * We intentionally build the event here instead of
     * importing createChatDelta, so the routing layer remains
     * explicit about what is sent to 9Router.
     */

    this._send({
      v: 1,
      type: MESSAGE_TYPE.EVENT,
      id:
        `evt_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 10)}`,

      timestamp:
        Date.now(),

      method:
        METHOD.CHAT_DELTA,

      payload: {
        requestId,
        agentId,
        seq,
        delta
      }
    });
  }


  // ==========================================================
  // Chat completed
  // ==========================================================

  async handleChatCompleted({
    requestId,
    agentId,
    content,
    conversationId = null,
    durationMs = null
  }) {

    const agent =
      this.agentRegistry.get(agentId);


    if (!agent) {
      return;
    }


    if (
      agent.activeRequestId !==
      requestId
    ) {

      console.warn(
        "[RequestRouter] Ignoring stale completion:",
        requestId
      );

      return;
    }


    // --------------------------------------------------------
    // Update conversation metadata
    // --------------------------------------------------------

    if (conversationId) {

      await this.agentRegistry.updateConversation(
        agentId,
        {
          conversationId
        }
      );
    }


    // --------------------------------------------------------
    // IMPORTANT:
    // Send completion before clearing state.
    // --------------------------------------------------------

    this._send(
      createResponse(
        requestId,
        {
          agentId,

          status:
            AGENT_STATUS.COMPLETED,

          content,

          conversationId,

          durationMs
        }
      )
    );


    // --------------------------------------------------------
    // Unlock agent
    // --------------------------------------------------------

    await this.agentRegistry.clearActiveRequest(
      agentId,
      requestId
    );


    this._send(
      createAgentStatus(
        agentId,
        AGENT_STATUS.IDLE
      )
    );


    console.log(
      "[RequestRouter] Chat completed:",
      requestId,
      "agent:",
      agentId
    );
  }


  // ==========================================================
  // Chat error
  // ==========================================================

  async handleChatError({
    requestId,
    agentId,
    error
  }) {

    const agent =
      this.agentRegistry.get(agentId);


    if (!agent) {
      return;
    }


    if (
      agent.activeRequestId !==
      requestId
    ) {
      return;
    }


    this._sendError(
      requestId,
      ERROR_CODE.SEND_FAILED,
      error?.message ||
      String(error) ||
      "Chat request failed",
      {
        agentId
      }
    );


    await this.agentRegistry.clearActiveRequest(
      agentId,
      requestId
    );


    this._send(
      createAgentStatus(
        agentId,
        AGENT_STATUS.IDLE
      )
    );
  }


  // ==========================================================
  // Find active request
  // ==========================================================

  _findAgentByRequestId(requestId) {

    const agents =
      this.agentRegistry.list();


    return (
      agents.find(
        (agent) =>
          agent.activeRequestId ===
          requestId
      ) || null
    );
  }


  // ==========================================================
  // Tab validation
  // ==========================================================

  async _isTabAvailable(tabId) {

    try {

      const tab =
        await chrome.tabs.get(
          tabId
        );

      return Boolean(tab);

    } catch {

      return false;
    }
  }


  // ==========================================================
  // Send protocol message
  // ==========================================================

  _send(message) {

    try {

      this.sendTo9Router(
        message
      );

    } catch (error) {

      console.error(
        "[RequestRouter] sendTo9Router failed:",
        error
      );
    }
  }


  // ==========================================================
  // Error response
  // ==========================================================

  _sendError(
    requestId,
    code,
    message,
    details = null
  ) {

    this._send(
      createError(
        requestId,
        code,
        message,
        details
      )
    );
  }
}