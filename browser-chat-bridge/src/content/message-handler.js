// src/content/message-handler.js

import {
  INTERNAL_MESSAGE
} from "../protocol/constants.js";


// ============================================================
// Constants
// ============================================================

const LOG_PREFIX =
  "[ContentMessageHandler]";


const NETWORK_EVENT = Object.freeze({
  INTERCEPTOR_READY:
    "network.interceptor.ready",

  STREAM_START:
    "conversation.stream.start",

  INPUT:
    "conversation.input",

  RESPONSE_STARTED:
    "conversation.response.started",

  RESPONSE_DELTA:
    "conversation.response.delta",

  RESPONSE_COMPLETED:
    "conversation.response.completed",

  STREAM_COMPLETE:
    "conversation.stream.complete",

  STREAM_ERROR:
    "conversation.stream.error"
});


// ============================================================
// Content Message Handler
// ============================================================

export class ContentMessageHandler {

  constructor({
    adapter
  }) {

    if (!adapter) {
      throw new Error(
        "ContentMessageHandler requires adapter"
      );
    }


    this.adapter =
      adapter;


    this.started =
      false;


    this.removeAdapterCallbacks =
      null;


    this.runtimeListener =
      this._handleRuntimeMessage.bind(
        this
      );


    // --------------------------------------------------------
    // Active Browser Chat request
    // --------------------------------------------------------

    /*
     * There is intentionally only one active request for
     * this ChatGPT tab.
     *
     * Browser Chat already guarantees one request per
     * registered agent/tab.
     */

    this.activeRequest =
      null;


    // --------------------------------------------------------
    // Network interceptor state
    // --------------------------------------------------------

    this.networkReady =
      false;


    this.lastNetworkStreamId =
      null;
  }


  // ==========================================================
  // Start
  // ==========================================================

  start() {

    if (this.started) {
      return;
    }


    this.started =
      true;


    // --------------------------------------------------------
    // Adapter / DOM fallback callbacks
    // --------------------------------------------------------

    this.removeAdapterCallbacks =
      this.adapter.observeResponse({

        onStarted:
          (event) => {

            this._handleDomChatStarted(
              event
            );
          },


        onDelta:
          (event) => {

            this._handleDomChatDelta(
              event
            );
          },


        onCompleted:
          (event) => {

            this._handleDomChatCompleted(
              event
            );
          },


        onError:
          (event) => {

            this._handleDomChatError(
              event
            );
          }
      });


    // --------------------------------------------------------
    // Background messages
    // --------------------------------------------------------

    chrome.runtime.onMessage.addListener(
      this.runtimeListener
    );


    console.log(
      LOG_PREFIX,
      "Started"
    );
  }


  // ==========================================================
  // Stop
  // ==========================================================

  stop() {

    if (!this.started) {
      return;
    }


    chrome.runtime.onMessage.removeListener(
      this.runtimeListener
    );


    if (
      typeof this.removeAdapterCallbacks ===
      "function"
    ) {

      this.removeAdapterCallbacks();
    }


    this.removeAdapterCallbacks =
      null;


    this.activeRequest =
      null;


    this.networkReady =
      false;


    this.lastNetworkStreamId =
      null;


    this.started =
      false;


    console.log(
      LOG_PREFIX,
      "Stopped"
    );
  }


  // ==========================================================
  // Runtime message
  // ==========================================================

  _handleRuntimeMessage(
    message,
    sender,
    sendResponse
  ) {

    if (
      !message ||
      typeof message !== "object"
    ) {

      sendResponse({
        accepted: false,
        error: "Invalid message"
      });

      return false;
    }


    switch (message.type) {

      // ------------------------------------------------------
      // CHAT_SEND
      // ------------------------------------------------------

      case INTERNAL_MESSAGE.CHAT_SEND:

        this._handleChatSend(
          message
        )
          .then(
            (result) => {

              sendResponse({
                accepted: true,
                ...result
              });
            }
          )
          .catch(
            (error) => {

              console.error(
                LOG_PREFIX,
                "CHAT_SEND failed:",
                error
              );


              sendResponse({
                accepted: false,

                error:
                  error?.message ||
                  String(error)
              });
            }
          );


        return true;


      // ------------------------------------------------------
      // CHAT_CANCEL
      // ------------------------------------------------------

      case INTERNAL_MESSAGE.CHAT_CANCEL:

        this._handleChatCancel(
          message
        )
          .then(
            (result) => {

              sendResponse({
                accepted: true,
                ...result
              });
            }
          )
          .catch(
            (error) => {

              console.error(
                LOG_PREFIX,
                "CHAT_CANCEL failed:",
                error
              );


              sendResponse({
                accepted: false,

                error:
                  error?.message ||
                  String(error)
              });
            }
          );


        return true;


      // ------------------------------------------------------
      // PROVIDER_STATUS
      // ------------------------------------------------------

      case INTERNAL_MESSAGE.PROVIDER_STATUS:

        try {

          sendResponse(
            this._getProviderStatus()
          );

        } catch (error) {

          sendResponse({
            detected: false,
            ready: false,

            error:
              error?.message ||
              String(error)
          });
        }


        return false;


      default:

        return false;
    }
  }


  // ==========================================================
  // CHAT_SEND
  // ==========================================================

  async _handleChatSend(
    message
  ) {

    const requestId =
      message.requestId;


    const agentId =
      message.agentId;


    const content =
      message.content;


    if (!requestId) {

      throw new Error(
        "CHAT_SEND requires requestId"
      );
    }


    if (!agentId) {

      throw new Error(
        "CHAT_SEND requires agentId"
      );
    }


    if (
      typeof content !== "string" ||
      !content.trim()
    ) {

      throw new Error(
        "CHAT_SEND requires content"
      );
    }


    if (
      this.activeRequest &&
      !this.activeRequest.terminal
    ) {

      throw new Error(
        `Request "${this.activeRequest.requestId}" is still active`
      );
    }


    console.log(
      LOG_PREFIX,
      "CHAT_SEND:",
      {
        requestId,
        agentId,
        length:
          content.length,

        networkReady:
          this.networkReady
      }
    );


    // --------------------------------------------------------
    // Create correlation context BEFORE clicking Send
    // --------------------------------------------------------

    /*
     * This must happen before adapter.sendMessage().
     *
     * ChatGPT's fetch can begin immediately after the
     * send button is clicked.
     */

    const request = {

      requestId,

      agentId,

      createdAt:
        Date.now(),

      submittedAt:
        null,


      // Browser Chat lifecycle

      started:
        false,

      terminal:
        false,


      // Which source owns the response?

      /*
       * null
       *    No source has claimed response yet.
       *
       * network
       *    Network SSE is primary.
       *
       * dom
       *    DOM observer became fallback.
       */

      source:
        null,


      // Network correlation

      streamId:
        null,

      chatgptRequestId:
        null,

      conversationId:
        null,

      messageId:
        null,

      turnExchangeId:
        null,


      // Streaming

      seq:
        0,

      content:
        "",


      // Diagnostics

      networkStarted:
        false,

      networkCompleted:
        false,

      networkError:
        null
    };


    this.activeRequest =
      request;


    try {

      const result =
        await this.adapter.sendMessage({
          requestId,
          agentId,
          content,

          options:
            message.options || {}
        });


      request.submittedAt =
        result?.submittedAt ??
        Date.now();


      return {
        requestId,
        agentId,

        provider:
          this.adapter.providerId,

        submitted:
          true,

        submitMethod:
          result?.submitMethod ??
          null,

        submittedAt:
          request.submittedAt
      };

    } catch (error) {

      /*
       * The message never entered a valid response lifecycle.
       */

      if (
        this.activeRequest ===
        request
      ) {

        this.activeRequest =
          null;
      }


      throw error;
    }
  }


  // ==========================================================
  // CHAT_CANCEL
  // ==========================================================

  async _handleChatCancel(
    message
  ) {

    const requestId =
      message.requestId;


    if (!requestId) {

      throw new Error(
        "CHAT_CANCEL requires requestId"
      );
    }


    console.log(
      LOG_PREFIX,
      "CHAT_CANCEL:",
      requestId
    );


    const result =
      await this.adapter.cancel(
        requestId
      );


    const request =
      this.activeRequest;


    if (
      request &&
      request.requestId ===
      requestId
    ) {

      request.terminal =
        true;


      this.activeRequest =
        null;
    }


    return {
      requestId,
      ...result
    };
  }


  // ==========================================================
  // PROVIDER STATUS
  // ==========================================================

  _getProviderStatus() {

    const status =
      this.adapter.getStatus();


    return {
      provider:
        this.adapter.providerId,

      detected:
        status.detected,

      ready:
        status.ready,

      busy:
        status.busy,

      conversationId:
        status.conversationId,

      title:
        status.title,

      request:
        status.request ??
        null,

      network: {
        ready:
          this.networkReady,

        activeStreamId:
          this.activeRequest
            ?.streamId ??
          null,

        responseSource:
          this.activeRequest
            ?.source ??
          null
      }
    };
  }


  // ==========================================================
  // Network bridge entry point
  // ==========================================================

  /*
   * Called by NetworkResponseBridge from content-script.js.
   */

  handleNetworkEvent(
    event
  ) {

    if (
      !event ||
      typeof event !== "object"
    ) {
      return;
    }


    const type =
      event.type;


    const payload =
      event.payload || {};


    switch (type) {

      // ------------------------------------------------------
      // Interceptor ready
      // ------------------------------------------------------

      case NETWORK_EVENT.INTERCEPTOR_READY:

        this.networkReady =
          true;


        console.log(
          LOG_PREFIX,
          "Network interceptor ready"
        );

        return;


      // ------------------------------------------------------
      // Stream start
      // ------------------------------------------------------

      case NETWORK_EVENT.STREAM_START:

        this._handleNetworkStreamStart(
          payload
        );

        return;


      // ------------------------------------------------------
      // Input correlation
      // ------------------------------------------------------

      case NETWORK_EVENT.INPUT:

        this._handleNetworkInput(
          payload
        );

        return;


      // ------------------------------------------------------
      // Assistant started
      // ------------------------------------------------------

      case NETWORK_EVENT.RESPONSE_STARTED:

        this._handleNetworkResponseStarted(
          payload
        );

        return;


      // ------------------------------------------------------
      // Assistant delta
      // ------------------------------------------------------

      case NETWORK_EVENT.RESPONSE_DELTA:

        this._handleNetworkResponseDelta(
          payload
        );

        return;


      // ------------------------------------------------------
      // Assistant completed
      // ------------------------------------------------------

      case NETWORK_EVENT.RESPONSE_COMPLETED:

        this._handleNetworkResponseCompleted(
          payload
        );

        return;


      // ------------------------------------------------------
      // Stream complete
      // ------------------------------------------------------

      case NETWORK_EVENT.STREAM_COMPLETE:

        this._handleNetworkStreamComplete(
          payload
        );

        return;


      // ------------------------------------------------------
      // Stream error
      // ------------------------------------------------------

      case NETWORK_EVENT.STREAM_ERROR:

        this._handleNetworkStreamError(
          payload
        );

        return;


      default:

        return;
    }
  }

  // ==========================================================
  // Network: stream start
  // ==========================================================

  _handleNetworkStreamStart(
    payload
  ) {

    const request =
      this._getActiveRequest();


    if (!request) {

      /*
       * Could be a message manually sent by the user
       * directly from ChatGPT Web.
       */

      console.debug(
        LOG_PREFIX,
        "Ignoring unowned network stream:",
        payload.streamId
      );

      return;
    }


    /*
     * One active Browser Chat request per tab means the
     * first conversation stream after CHAT_SEND belongs
     * to the active request.
     */

    if (
      request.streamId &&
      request.streamId !==
      payload.streamId
    ) {

      console.debug(
        LOG_PREFIX,
        "Ignoring additional network stream:",
        payload.streamId
      );

      return;
    }


    // --------------------------------------------------------
    // Correlate stream
    // --------------------------------------------------------

    request.streamId =
      payload.streamId ??
      request.streamId;


    request.networkStarted =
      true;


    this.lastNetworkStreamId =
      request.streamId;


    // --------------------------------------------------------
    // Network claims ownership immediately
    // --------------------------------------------------------

    /*
     * IMPORTANT:
     *
     * Do not wait until RESPONSE_STARTED.
     *
     * Once POST /backend-api/f/conversation has produced its
     * SSE stream, that stream belongs to the active Browser
     * Chat request.
     *
     * DOM generation detection can happen shortly afterwards.
     * If we leave source=null here, DOM may claim the request
     * first and return a truncated response.
     */

    if (
      request.source ===
      null
    ) {

      request.source =
        "network";


      console.log(
        LOG_PREFIX,
        "Network claimed request",
        {
          requestId:
            request.requestId,

          streamId:
            request.streamId
        }
      );
    }


    console.debug(
      LOG_PREFIX,
      "Network stream correlated",
      {
        requestId:
          request.requestId,

        streamId:
          request.streamId,

        source:
          request.source
      }
    );
  }

  // ==========================================================
  // Network: input
  // ==========================================================

  _handleNetworkInput(
    payload
  ) {

    const request =
      this._getNetworkRequest(
        payload.streamId
      );


    if (!request) {
      return;
    }


    request.chatgptRequestId =
      payload.requestId ??
      request.chatgptRequestId;


    request.conversationId =
      payload.conversationId ??
      request.conversationId;


    request.turnExchangeId =
      payload.turnExchangeId ??
      request.turnExchangeId;


    console.debug(
      LOG_PREFIX,
      "Network request identified",
      {
        requestId:
          request.requestId,

        streamId:
          request.streamId,

        chatgptRequestId:
          request.chatgptRequestId
      }
    );
  }


  // ==========================================================
  // Network: response started
  // ==========================================================

  _handleNetworkResponseStarted(
    payload
  ) {

    const request =
      this._getNetworkRequest(
        payload.streamId
      );


    if (!request) {
      return;
    }


    // --------------------------------------------------------
    // Network claims ownership
    // --------------------------------------------------------

    if (
      request.source === "dom"
    ) {

      /*
       * DOM already emitted data for this request.
       *
       * Do not switch sources halfway through because that
       * would duplicate output.
       */

      console.debug(
        LOG_PREFIX,
        "Network response arrived after DOM fallback"
      );

      return;
    }


    request.source =
      "network";


    request.chatgptRequestId =
      payload.requestId ??
      request.chatgptRequestId;


    request.conversationId =
      payload.conversationId ??
      request.conversationId;


    request.messageId =
      payload.messageId ??
      request.messageId;


    request.turnExchangeId =
      payload.turnExchangeId ??
      request.turnExchangeId;


    this._emitStarted(
      request,
      "network"
    );
  }


  // ==========================================================
  // Network: response delta
  // ==========================================================

  _handleNetworkResponseDelta(
    payload
  ) {

    const request =
      this._getNetworkRequest(
        payload.streamId
      );


    if (
      !request ||
      request.source !==
      "network" ||
      request.terminal
    ) {
      return;
    }


    const delta =
      payload.delta;


    if (
      typeof delta !== "string" ||
      delta.length === 0
    ) {
      return;
    }


    request.seq++;


    request.content +=
      delta;


    this._sendToBackground({
      type:
        INTERNAL_MESSAGE.CHAT_DELTA,

      requestId:
        request.requestId,

      agentId:
        request.agentId,

      seq:
        request.seq,

      delta,

      fullText:
        request.content,

      replace:
        false
    });
  }


  // ==========================================================
  // Network: response completed
  // ==========================================================

  _handleNetworkResponseCompleted(
    payload
  ) {

    const request =
      this._getNetworkRequest(
        payload.streamId
      );


    if (
      !request ||
      request.source !==
      "network" ||
      request.terminal
    ) {
      return;
    }


    const content =
      typeof payload.content ===
        "string"
        ? payload.content
        : request.content;


    /*
     * Network interceptor is authoritative for the final
     * Markdown once it owns this request.
     */

    request.content =
      content;


    request.networkCompleted =
      true;


    request.conversationId =
      payload.conversationId ??
      request.conversationId;


    request.messageId =
      payload.messageId ??
      request.messageId;


    request.turnExchangeId =
      payload.turnExchangeId ??
      request.turnExchangeId;


    const durationMs =
      Number.isFinite(
        payload.durationMs
      )
        ? payload.durationMs
        : Date.now() -
        request.createdAt;


    console.log(
      LOG_PREFIX,
      "CHAT_COMPLETED via NETWORK:",
      {
        requestId:
          request.requestId,

        length:
          content.length,

        deltaCount:
          request.seq,

        durationMs
      }
    );

    // --------------------------------------------------------
    // Finalize local lifecycle BEFORE notifying background.
    //
    // Network is authoritative for this request. The adapter's
    // DOM observer must be stopped and its request lock released
    // before Codex receives CHAT_COMPLETED.
    //
    // Codex may immediately send the next role:"tool" request.
    // --------------------------------------------------------

    if (
      typeof this.adapter
        .completeCurrentRequest ===
      "function"
    ) {

      const completion =
        this.adapter
          .completeCurrentRequest(
            request.requestId
          );


      if (
        completion &&
        completion.completed ===
        false
      ) {

        console.warn(
          LOG_PREFIX,
          "Unable to finalize adapter request:",
          completion
        );
      }
    }


    // --------------------------------------------------------
    // Mark ContentMessageHandler request terminal BEFORE
    // notifying background for the same reason.
    // --------------------------------------------------------

    this._markTerminal(
      request
    );


    // --------------------------------------------------------
    // Notify background only after BOTH lifecycle locks have
    // been released / marked terminal.
    // --------------------------------------------------------

    this._sendToBackground({
      type:
        INTERNAL_MESSAGE.CHAT_COMPLETED,

      requestId:
        request.requestId,

      agentId:
        request.agentId,

      content,

      conversationId:
        request.conversationId ??
        this.adapter.getConversationId?.() ??
        null,

      title:
        this.adapter.getTitle?.() ??
        null,

      durationMs
    });
  }


  // ==========================================================
  // Network: stream complete
  // ==========================================================

  _handleNetworkStreamComplete(
    payload
  ) {

    /*
     * Usually RESPONSE_COMPLETED has already finished the
     * Browser Chat request.
     *
     * STREAM_COMPLETE is mainly diagnostic.
     */

    const request =
      this._getNetworkRequest(
        payload.streamId,
        {
          allowTerminal:
            true
        }
      );


    if (!request) {
      return;
    }


    console.debug(
      LOG_PREFIX,
      "Network stream complete",
      {
        requestId:
          request.requestId,

        streamId:
          payload.streamId,

        successful:
          payload.successful,

        responseLength:
          payload.responseLength
      }
    );
  }


  // ==========================================================
  // Network: error
  // ==========================================================

  _handleNetworkStreamError(
    payload
  ) {

    const request =
      this._getNetworkRequest(
        payload.streamId
      );


    if (!request) {
      return;
    }


    request.networkError =
      payload.error ||
      "Network stream error";


    console.warn(
      LOG_PREFIX,
      "Network response failed; DOM fallback remains active",
      {
        requestId:
          request.requestId,

        streamId:
          request.streamId,

        error:
          request.networkError
      }
    );


    /*
     * IMPORTANT:
     *
     * Do NOT emit CHAT_ERROR here.
     *
     * The DOM observer is our fallback and may still
     * complete the same response successfully.
     */


    if (
      request.source ===
      "network"
    ) {

      /*
       * Network claimed the request but failed before
       * completing.
       *
       * Release ownership so DOM can finish it.
       */

      request.source =
        null;


      request.seq =
        0;


      request.content =
        "";


      request.started =
        false;
    }
  }


  // ==========================================================
  // DOM fallback: started
  // ==========================================================

  _handleDomChatStarted(
    event
  ) {

    const request =
      this._getRequestForDomEvent(
        event
      );


    if (!request) {
      return;
    }


    // Network already owns this request.

    if (
      request.source ===
      "network"
    ) {

      console.debug(
        LOG_PREFIX,
        "Ignoring DOM started; network owns request:",
        request.requestId
      );

      return;
    }


    if (
      request.source === null
    ) {

      request.source =
        "dom";


      console.log(
        LOG_PREFIX,
        "Using DOM response fallback:",
        request.requestId
      );
    }


    this._emitStarted(
      request,
      "dom"
    );
  }


  // ==========================================================
  // DOM fallback: delta
  // ==========================================================

  _handleDomChatDelta(
    event
  ) {

    const request =
      this._getRequestForDomEvent(
        event
      );


    if (
      !request ||
      request.source ===
      "network" ||
      request.terminal
    ) {
      return;
    }


    if (
      request.source === null
    ) {

      request.source =
        "dom";
    }


    if (!event.delta) {
      return;
    }


    this._sendToBackground({
      type:
        INTERNAL_MESSAGE.CHAT_DELTA,

      requestId:
        request.requestId,

      agentId:
        request.agentId,

      seq:
        event.seq,

      delta:
        event.delta,

      fullText:
        event.fullText,

      replace:
        Boolean(
          event.replace
        )
    });
  }


  // ==========================================================
  // DOM fallback: completed
  // ==========================================================

  _handleDomChatCompleted(
    event
  ) {

    const request =
      this._getRequestForDomEvent(
        event
      );


    if (!request) {
      return;
    }


    // --------------------------------------------------------
    // Network already completed / owns request
    // --------------------------------------------------------

    if (
      request.source ===
      "network" ||
      request.terminal
    ) {

      console.debug(
        LOG_PREFIX,
        "Ignoring DOM completion; network already handled request:",
        event.requestId
      );

      return;
    }


    request.source =
      "dom";


    console.log(
      LOG_PREFIX,
      "CHAT_COMPLETED via DOM:",
      {
        requestId:
          event.requestId,

        length:
          event.content?.length ??
          0,

        durationMs:
          event.durationMs
      }
    );


    this._sendToBackground({
      type:
        INTERNAL_MESSAGE.CHAT_COMPLETED,

      requestId:
        request.requestId,

      agentId:
        request.agentId,

      content:
        event.content,

      conversationId:
        event.conversationId ??
        null,

      title:
        event.title ??
        null,

      durationMs:
        event.durationMs ??
        null
    });


    this._markTerminal(
      request
    );
  }


  // ==========================================================
  // DOM fallback: error
  // ==========================================================

  _handleDomChatError(
    event
  ) {

    const request =
      this._getRequestForDomEvent(
        event
      );


    if (!request) {
      return;
    }


    /*
     * If Network currently owns the request, a DOM observer
     * error must not kill a healthy Network response.
     */

    if (
      request.source ===
      "network"
    ) {

      console.debug(
        LOG_PREFIX,
        "Ignoring DOM error; network owns request:",
        request.requestId
      );

      return;
    }


    const error =
      event.error;


    console.error(
      LOG_PREFIX,
      "CHAT_ERROR via DOM:",
      request.requestId,
      error
    );


    this._sendToBackground({
      type:
        INTERNAL_MESSAGE.CHAT_ERROR,

      requestId:
        request.requestId,

      agentId:
        request.agentId,

      error: {
        name:
          error?.name ||
          "Error",

        message:
          error?.message ||
          String(error) ||
          "Unknown ChatGPT error"
      }
    });


    this._markTerminal(
      request
    );
  }


  // ==========================================================
  // Emit started
  // ==========================================================

  _emitStarted(
    request,
    source
  ) {

    if (
      request.started ||
      request.terminal
    ) {
      return;
    }


    request.started =
      true;


    console.log(
      LOG_PREFIX,
      "CHAT_STARTED:",
      {
        requestId:
          request.requestId,

        source
      }
    );


    this._sendToBackground({
      type:
        INTERNAL_MESSAGE.CHAT_STARTED,

      requestId:
        request.requestId,

      agentId:
        request.agentId
    });
  }


  // ==========================================================
  // Active request helpers
  // ==========================================================

  _getActiveRequest() {

    const request =
      this.activeRequest;


    if (
      !request ||
      request.terminal
    ) {
      return null;
    }


    return request;
  }


  _getNetworkRequest(
    streamId,
    {
      allowTerminal = false
    } = {}
  ) {

    const request =
      this.activeRequest;


    if (!request) {
      return null;
    }


    if (
      !allowTerminal &&
      request.terminal
    ) {
      return null;
    }


    if (
      request.streamId &&
      streamId &&
      request.streamId !==
      streamId
    ) {
      return null;
    }


    /*
     * RESPONSE_STARTED can theoretically arrive before the
     * stream-start event is processed by the isolated world.
     *
     * Bind lazily if necessary.
     */

    if (
      !request.streamId &&
      streamId
    ) {

      request.streamId =
        streamId;


      this.lastNetworkStreamId =
        streamId;
    }


    return request;
  }


  _getRequestForDomEvent(
    event
  ) {

    const request =
      this.activeRequest;


    if (
      !request ||
      request.terminal
    ) {
      return null;
    }


    /*
     * Adapter events use Browser Chat requestId,
     * unlike ChatGPT's internal network requestId.
     */

    if (
      event?.requestId &&
      event.requestId !==
      request.requestId
    ) {

      console.debug(
        LOG_PREFIX,
        "Ignoring stale DOM event:",
        {
          active:
            request.requestId,

          received:
            event.requestId
        }
      );


      return null;
    }


    return request;
  }


  // ==========================================================
  // Terminal lifecycle
  // ==========================================================

  _markTerminal(
    request
  ) {

    if (!request) {
      return;
    }


    request.terminal =
      true;


    /*
     * Keep activeRequest temporarily until the current JS
     * stack/event queue has drained.
     *
     * This lets late STREAM_COMPLETE / DOM events be safely
     * recognized as belonging to the just-finished request.
     */

    queueMicrotask(
      () => {

        if (
          this.activeRequest ===
          request
        ) {

          this.activeRequest =
            null;
        }
      }
    );
  }


  // ==========================================================
  // Send message to background
  // ==========================================================

  _sendToBackground(
    message
  ) {

    try {

      const result =
        chrome.runtime.sendMessage(
          message
        );


      if (
        result &&
        typeof result.catch ===
        "function"
      ) {

        result.catch(
          (error) => {

            console.debug(
              LOG_PREFIX,
              "Background unavailable:",
              error
            );
          }
        );
      }

    } catch (error) {

      console.debug(
        LOG_PREFIX,
        "Unable to send background message:",
        error
      );
    }
  }
}