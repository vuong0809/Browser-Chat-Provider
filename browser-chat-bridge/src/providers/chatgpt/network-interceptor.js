/**
 * Browser Chat Bridge
 * ChatGPT Network Stream Interceptor
 *
 * Runs in ChatGPT MAIN world.
 *
 * Responsibilities:
 * - Hook window.fetch()
 * - Detect POST /backend-api/f/conversation
 * - Clone the SSE response without modifying ChatGPT's response
 * - Parse ChatGPT delta_encoding v1
 * - Track the user input message
 * - Track the visible assistant "final" message
 * - Emit raw Markdown/text deltas
 * - Emit final accumulated Markdown/text
 * - Collect protocol diagnostics without logging content
 *
 * Events emitted through window.postMessage():
 *
 * conversation.stream.start
 * conversation.input
 * conversation.response.started
 * conversation.response.delta
 * conversation.response.completed
 * conversation.stream.complete
 * conversation.stream.error
 *
 * This module does NOT:
 * - modify ChatGPT requests
 * - modify ChatGPT responses
 * - access cookies/tokens
 * - forward resume tokens
 * - manipulate the DOM
 */

(() => {
  "use strict";

  // ============================================================
  // Constants
  // ============================================================

  const PREFIX =
    "[BrowserChatNetwork]";

  const SOURCE =
    "browser-chat-network";

  const VERSION =
    1;

  const CONVERSATION_ENDPOINT =
    "/backend-api/f/conversation";

  const ASSISTANT_CHANNEL =
    "final";

  const ASSISTANT_CONTENT_TYPE =
    "text";

  const INSTALL_KEY =
    "__BROWSER_CHAT_NETWORK_INTERCEPTOR_V1__";


  if (window[INSTALL_KEY]) {

    console.log(
      PREFIX,
      "Interceptor already installed"
    );

    return;
  }


  window[INSTALL_KEY] =
    true;


  // ============================================================
  // Original browser functions
  // ============================================================

  const originalFetch =
    window.fetch;


  if (
    typeof originalFetch !==
    "function"
  ) {

    console.error(
      PREFIX,
      "window.fetch unavailable"
    );

    return;
  }


  // ============================================================
  // Utilities
  // ============================================================

  function createId(
    prefix = "stream"
  ) {

    try {

      return (
        `${prefix}_${crypto.randomUUID()}`
      );

    } catch {

      return (
        `${prefix}_` +
        Date.now().toString(36) +
        "_" +
        Math.random()
          .toString(36)
          .slice(2)
      );
    }
  }


  function getRequestUrl(
    input
  ) {

    try {

      if (
        typeof input ===
        "string"
      ) {

        return new URL(
          input,
          location.href
        );
      }


      if (
        input instanceof URL
      ) {

        return input;
      }


      if (
        input instanceof Request
      ) {

        return new URL(
          input.url,
          location.href
        );
      }


      return new URL(
        String(input),
        location.href
      );

    } catch {

      return null;
    }
  }


  function getRequestMethod(
    input,
    init
  ) {

    try {

      if (init?.method) {

        return String(
          init.method
        ).toUpperCase();
      }


      if (
        input instanceof Request
      ) {

        return String(
          input.method ||
          "GET"
        ).toUpperCase();
      }


      return "GET";

    } catch {

      return "GET";
    }
  }


  function getContentType(
    response
  ) {

    try {

      return (
        response.headers.get(
          "content-type"
        ) ||
        ""
      );

    } catch {

      return "";
    }
  }


  function isConversationStream(
    url,
    method,
    response
  ) {

    if (!url) {
      return false;
    }


    if (
      url.origin !==
      location.origin
    ) {

      return false;
    }


    if (
      method !==
      "POST"
    ) {

      return false;
    }


    if (
      url.pathname !==
      CONVERSATION_ENDPOINT
    ) {

      return false;
    }


    const contentType =
      getContentType(
        response
      ).toLowerCase();


    return contentType.includes(
      "text/event-stream"
    );
  }


  function safeString(
    value
  ) {

    return (
      typeof value ===
        "string"
        ? value
        : ""
    );
  }


  function safeError(
    error
  ) {

    if (
      error instanceof Error
    ) {

      return (
        error.message ||
        error.name ||
        "Unknown error"
      );
    }


    return String(
      error ||
      "Unknown error"
    );
  }


  // ============================================================
  // Event bridge
  // ============================================================

  function emit(
    type,
    payload = {}
  ) {

    try {

      window.postMessage(
        {
          source:
            SOURCE,

          version:
            VERSION,

          type,

          timestamp:
            Date.now(),

          payload
        },
        location.origin
      );

    } catch (error) {

      console.debug(
        PREFIX,
        "postMessage failed",
        type,
        error
      );
    }
  }


  // ============================================================
  // SSE parser
  // ============================================================

  function createSSEParser(
    onEvent
  ) {

    let buffer =
      "";


    function processBlock(
      block
    ) {

      if (
        !block ||
        !block.trim()
      ) {

        return;
      }


      const lines =
        block.split(
          /\r?\n/
        );


      let eventName =
        "message";


      const dataLines =
        [];


      for (
        const line of lines
      ) {

        if (!line) {
          continue;
        }


        if (
          line.startsWith(":")
        ) {

          continue;
        }


        if (
          line.startsWith(
            "event:"
          )
        ) {

          eventName =
            line
              .slice(6)
              .trim();

          continue;
        }


        if (
          line.startsWith(
            "data:"
          )
        ) {

          let value =
            line.slice(5);


          if (
            value.startsWith(
              " "
            )
          ) {

            value =
              value.slice(1);
          }


          dataLines.push(
            value
          );
        }
      }


      if (
        dataLines.length ===
        0
      ) {

        return;
      }


      onEvent({
        event:
          eventName,

        data:
          dataLines.join(
            "\n"
          )
      });
    }


    return {

      push(
        chunk
      ) {

        buffer +=
          chunk;


        while (true) {

          const match =
            buffer.match(
              /\r?\n\r?\n/
            );


          if (
            !match ||
            match.index ==
            null
          ) {

            break;
          }


          const index =
            match.index;


          const block =
            buffer.slice(
              0,
              index
            );


          buffer =
            buffer.slice(
              index +
              match[0].length
            );


          processBlock(
            block
          );
        }
      },


      flush() {

        if (
          buffer.trim()
        ) {

          processBlock(
            buffer
          );
        }


        buffer =
          "";
      }
    };
  }


  // ============================================================
  // ChatGPT delta-v1 state
  // ============================================================

  function createStreamState(
    streamId
  ) {

    return {

      streamId,

      deltaEncoding:
        null,

      conversationId:
        null,

      requestId:
        null,

      turnExchangeId:
        null,

      userMessageId:
        null,

      userTurnId:
        null,

      assistantMessageId:
        null,

      assistantTurnId:
        null,

      assistantStarted:
        false,

      assistantFinished:
        false,

      streamCompleted:
        false,

      doneReceived:
        false,

      content:
        "",

      eventCount:
        0,

      deltaCount:
        0,


      // --------------------------------------------------------
      // delta_encoding v1 continuation state
      // --------------------------------------------------------

      deltaV1: {

        operation:
          null,

        path:
          null
      },

      // --------------------------------------------------------
      // Protocol diagnostics
      // --------------------------------------------------------

      diagnostics: {

        sseEvents:
          Object.create(null),

        deltaShapes:
          Object.create(null),

        patchPaths:
          Object.create(null),

        patchOps:
          Object.create(null),

        patchValueTypes:
          Object.create(null),

        deltaEventCount:
          0,

        patchBatchCount:
          0,

        patchItemCount:
          0,

        initialMessageCount:
          0,

        finalAssistantMessageCount:
          0,

        handledTextPatchCount:
          0,

        ignoredPatchCount:
          0,

        maxPatchBatchSize:
          0,
        // --------------------------------------------------------
        // v:string diagnostics
        // --------------------------------------------------------

        vStringCount:
          0,

        vStringLengths:
          [],

        vStringSamples:
          []
      },


      rawBytes:
        0,

      startedAt:
        Date.now(),

      completedAt:
        null
    };
  }


  // ============================================================
  // Message helpers
  // ============================================================

  function getMessageFromDelta(
    data
  ) {

    return (
      data &&
        typeof data ===
        "object" &&
        data.v &&
        typeof data.v ===
        "object"
        ? data.v.message ||
        null
        : null
    );
  }


  function isUserMessage(
    message
  ) {

    return (
      message?.author?.role ===
      "user"
    );
  }


  function isFinalAssistantMessage(
    message
  ) {

    return (
      message?.author?.role ===
      "assistant" &&

      message?.channel ===
      ASSISTANT_CHANNEL &&

      message?.content
        ?.content_type ===
      ASSISTANT_CONTENT_TYPE
    );
  }


  function getInitialText(
    message
  ) {

    const parts =
      message?.content?.parts;


    if (
      !Array.isArray(
        parts
      )
    ) {

      return "";
    }


    return safeString(
      parts[0]
    );
  }


  // ============================================================
  // Input message
  // ============================================================

  function handleInputMessage(
    state,
    data
  ) {

    if (
      data?.type !==
      "input_message"
    ) {

      return false;
    }


    const message =
      data.input_message;


    if (
      !isUserMessage(
        message
      )
    ) {

      return false;
    }


    state.conversationId =
      data.conversation_id ||
      state.conversationId;


    state.userMessageId =
      message.id ||
      state.userMessageId;


    state.requestId =
      message.metadata
        ?.request_id ||
      state.requestId;


    state.turnExchangeId =
      message.metadata
        ?.turn_exchange_id ||
      state.turnExchangeId;


    state.userTurnId =
      message.metadata
        ?.turn_id ||
      state.userTurnId;


    /*
     * Do not emit the user's actual prompt.
     */

    emit(
      "conversation.input",
      {
        streamId:
          state.streamId,

        conversationId:
          state.conversationId,

        requestId:
          state.requestId,

        turnExchangeId:
          state.turnExchangeId,

        userMessageId:
          state.userMessageId,

        userTurnId:
          state.userTurnId
      }
    );


    console.debug(
      PREFIX,
      "Input message identified",
      {
        streamId:
          state.streamId,

        conversationId:
          state.conversationId,

        userMessageId:
          state.userMessageId,

        requestId:
          state.requestId
      }
    );


    return true;
  }


  // ============================================================
  // Assistant message start
  // ============================================================

  function startAssistantMessage(
    state,
    message,
    conversationId
  ) {

    if (
      !isFinalAssistantMessage(
        message
      )
    ) {

      return false;
    }


    if (
      state.assistantMessageId &&
      state.assistantMessageId !==
      message.id
    ) {

      return false;
    }


    state.conversationId =
      conversationId ||
      state.conversationId;


    state.assistantMessageId =
      message.id ||
      state.assistantMessageId;


    state.assistantTurnId =
      message.metadata
        ?.turn_id ||
      state.assistantTurnId;


    state.requestId =
      message.metadata
        ?.request_id ||
      state.requestId;


    state.turnExchangeId =
      message.metadata
        ?.turn_exchange_id ||
      state.turnExchangeId;


    const initialText =
      getInitialText(
        message
      );


    if (
      !state.assistantStarted
    ) {

      state.assistantStarted =
        true;


      state.content =
        initialText;


      emit(
        "conversation.response.started",
        {
          streamId:
            state.streamId,

          conversationId:
            state.conversationId,

          requestId:
            state.requestId,

          turnExchangeId:
            state.turnExchangeId,

          messageId:
            state.assistantMessageId,

          turnId:
            state.assistantTurnId
        }
      );


      console.log(
        PREFIX,
        "RESPONSE STARTED",
        {
          streamId:
            state.streamId,

          messageId:
            state.assistantMessageId,

          requestId:
            state.requestId
        }
      );


      if (
        initialText
      ) {

        state.deltaCount++;


        emit(
          "conversation.response.delta",
          {
            streamId:
              state.streamId,

            conversationId:
              state.conversationId,

            requestId:
              state.requestId,

            messageId:
              state.assistantMessageId,

            index:
              state.deltaCount,

            delta:
              initialText
          }
        );
      }
    }


    return true;
  }


  // ============================================================
  // Protocol diagnostics
  // ============================================================

  function incrementCounter(
    object,
    key
  ) {

    const normalized =
      String(
        key ??
        "null"
      );


    object[normalized] =
      (
        object[normalized] ||
        0
      ) + 1;
  }


  function getValueType(
    value
  ) {

    if (
      value === null
    ) {

      return "null";
    }


    if (
      Array.isArray(
        value
      )
    ) {

      return "array";
    }


    return typeof value;
  }


  function describeDeltaShape(
    data
  ) {

    if (
      !data ||
      typeof data !==
      "object"
    ) {

      return "non-object";
    }


    if (
      data.o ===
      "patch" &&
      Array.isArray(
        data.v
      )
    ) {

      return "patch-array";
    }


    if (
      data.v &&
      typeof data.v ===
      "object" &&
      data.v.message
    ) {

      return "message-snapshot";
    }


    if (
      Object.prototype
        .hasOwnProperty.call(
          data,
          "v"
        )
    ) {

      return (
        "v:" +
        getValueType(
          data.v
        )
      );
    }


    return (
      "keys:" +
      Object.keys(
        data
      )
        .sort()
        .join(",")
    );
  }

  function recordVStringDiagnostic(
    state,
    data
  ) {

    if (
      !data ||
      typeof data !== "object" ||
      typeof data.v !== "string"
    ) {

      return;
    }


    const diagnostics =
      state.diagnostics;


    diagnostics.vStringCount++;


    diagnostics.vStringLengths.push(
      data.v.length
    );


    /*
     * IMPORTANT:
     *
     * Do not log the actual value.
     *
     * We only record structural properties so that
     * prompts / responses / identifiers are not exposed
     * through protocol diagnostics.
     */

    diagnostics.vStringSamples.push({
      length:
        data.v.length,

      operation:
        typeof data.o === "string"
          ? data.o
          : null,

      hasPath:
        typeof data.p === "string",

      startsWithSlash:
        data.v.startsWith("/"),

      looksLikeJson:
        data.v.startsWith("{") ||
        data.v.startsWith("["),

      containsNewline:
        data.v.includes("\n")
    });
  }

  function recordPatchDiagnostic(
    state,
    patch,
    handled
  ) {

    const diagnostics =
      state.diagnostics;


    diagnostics.patchItemCount++;


    incrementCounter(
      diagnostics.patchPaths,
      patch?.p ??
      "(no-path)"
    );


    incrementCounter(
      diagnostics.patchOps,
      patch?.o ??
      "(no-op)"
    );


    incrementCounter(
      diagnostics.patchValueTypes,
      getValueType(
        patch?.v
      )
    );


    if (
      !handled
    ) {

      diagnostics.ignoredPatchCount++;
    }
  }


  function printProtocolDiagnostics(
    state,
    reason
  ) {

    const diagnostics =
      state.diagnostics;


    console.log(
      PREFIX,
      "PROTOCOL DIAGNOSTICS",
      {
        streamId:
          state.streamId,

        encoding:
          state.deltaEncoding,

        reason,

        eventCount:
          state.eventCount,

        rawBytes:
          state.rawBytes,

        responseLength:
          state.content.length,

        responseDeltaCount:
          state.deltaCount,

        deltaEventCount:
          diagnostics.deltaEventCount,

        patchBatchCount:
          diagnostics.patchBatchCount,

        patchItemCount:
          diagnostics.patchItemCount,

        handledTextPatchCount:
          diagnostics.handledTextPatchCount,

        ignoredPatchCount:
          diagnostics.ignoredPatchCount,

        maxPatchBatchSize:
          diagnostics.maxPatchBatchSize,

        vStringCount:
          diagnostics.vStringCount,

        vStringLengths:
          [
            ...diagnostics.vStringLengths
          ],

        vStringSamples:
          diagnostics.vStringSamples.map(
            (item) => ({
              ...item
            })
          ),

        initialMessageCount:
          diagnostics.initialMessageCount,

        finalAssistantMessageCount:
          diagnostics.finalAssistantMessageCount,

        sseEvents: {
          ...diagnostics.sseEvents
        },

        deltaShapes: {
          ...diagnostics.deltaShapes
        },

        patchOps: {
          ...diagnostics.patchOps
        },

        patchValueTypes: {
          ...diagnostics.patchValueTypes
        },

        patchPaths: {
          ...diagnostics.patchPaths
        }
      }
    );
  }


  // ============================================================
  // Delta patch handling
  // ============================================================

  function appendAssistantText(
    state,
    text
  ) {

    if (
      !state.assistantStarted ||
      state.assistantFinished ||
      typeof text !==
      "string" ||
      text.length ===
      0
    ) {

      return;
    }


    state.content +=
      text;


    state.deltaCount++;


    emit(
      "conversation.response.delta",
      {
        streamId:
          state.streamId,

        conversationId:
          state.conversationId,

        requestId:
          state.requestId,

        turnExchangeId:
          state.turnExchangeId,

        messageId:
          state.assistantMessageId,

        index:
          state.deltaCount,

        delta:
          text
      }
    );


    console.debug(
      PREFIX,
      "RESPONSE DELTA",
      {
        streamId:
          state.streamId,

        index:
          state.deltaCount,

        length:
          text.length,

        totalLength:
          state.content.length
      }
    );
  }


  function finishAssistant(
    state,
    reason =
      "finished_successfully"
  ) {

    if (
      !state.assistantStarted ||
      state.assistantFinished
    ) {

      return;
    }


    state.assistantFinished =
      true;


    state.completedAt =
      Date.now();


    emit(
      "conversation.response.completed",
      {
        streamId:
          state.streamId,

        conversationId:
          state.conversationId,

        requestId:
          state.requestId,

        turnExchangeId:
          state.turnExchangeId,

        messageId:
          state.assistantMessageId,

        turnId:
          state.assistantTurnId,

        content:
          state.content,

        length:
          state.content.length,

        deltaCount:
          state.deltaCount,

        reason,

        durationMs:
          state.completedAt -
          state.startedAt
      }
    );


    console.log(
      PREFIX,
      "RESPONSE COMPLETED",
      {
        streamId:
          state.streamId,

        messageId:
          state.assistantMessageId,

        length:
          state.content.length,

        deltaCount:
          state.deltaCount,

        durationMs:
          state.completedAt -
          state.startedAt,

        reason
      }
    );
  }
 function handleDeltaV1String(
    state,
    data
  ) {

    if (
      state.deltaEncoding !==
        "v1" ||
      !data ||
      typeof data !==
        "object" ||
      typeof data.v !==
        "string"
    ) {

      return false;
    }


    const continuation =
      state.deltaV1;


    /*
     * delta_encoding v1 can establish an operation/path once
     * and then send later string values without repeating them.
     *
     * Example:
     *
     * { o: "append", p: "/message/content/parts/0", v: "..." }
     * { v: "..." }
     * { v: "..." }
     *
     * Only the assistant text path is accepted.
     */

    if (
      typeof data.o ===
        "string"
    ) {

      continuation.operation =
        data.o;
    }


    if (
      typeof data.p ===
        "string"
    ) {

      continuation.path =
        data.p;
    }


    if (
      continuation.operation !==
        "append" ||
      continuation.path !==
        "/message/content/parts/0"
    ) {

      return false;
    }


    appendAssistantText(
      state,
      data.v
    );


    return true;
  }

  function handlePatch(
    state,
    data
  ) {

    if (
      data?.o !==
      "patch" ||
      !Array.isArray(
        data.v
      )
    ) {

      return false;
    }


    const diagnostics =
      state.diagnostics;


    diagnostics.patchBatchCount++;


    diagnostics.maxPatchBatchSize =
      Math.max(
        diagnostics.maxPatchBatchSize,
        data.v.length
      );


    for (
      const patch of data.v
    ) {

      if (
        !patch ||
        typeof patch !==
        "object"
      ) {

        diagnostics.ignoredPatchCount++;

        continue;
      }


      let handled =
        false;


      // --------------------------------------------------------
      // Assistant text append
      // --------------------------------------------------------

      if (
        patch.p ===
        "/message/content/parts/0" &&
        patch.o ===
        "append" &&
        typeof patch.v ===
        "string"
      ) {

        diagnostics.handledTextPatchCount++;


        appendAssistantText(
          state,
          patch.v
        );


        handled =
          true;
      }


      // --------------------------------------------------------
      // Status
      // --------------------------------------------------------

      else if (
        patch.p ===
        "/message/status" &&
        patch.o ===
        "replace"
      ) {

        handled =
          true;


        if (
          patch.v ===
          "finished_successfully"
        ) {

          finishAssistant(
            state,
            "finished_successfully"
          );
        }
      }


      // --------------------------------------------------------
      // end_turn
      // --------------------------------------------------------

      else if (
        patch.p ===
        "/message/end_turn" &&
        patch.o ===
        "replace"
      ) {

        handled =
          true;
      }


      recordPatchDiagnostic(
        state,
        patch,
        handled
      );
    }


    return true;
  }


  // ============================================================
  // Delta event handling
  // ============================================================

  function handleDeltaEvent(
    state,
    data
  ) {

    if (
      !data ||
      typeof data !==
      "object"
    ) {

      return;
    }


    const diagnostics =
      state.diagnostics;


    diagnostics.deltaEventCount++;


    incrementCounter(
      diagnostics.deltaShapes,
      describeDeltaShape(
        data
      )
    );
    // ----------------------------------------------------------
    // Diagnose top-level v:string
    // ----------------------------------------------------------

    recordVStringDiagnostic(
      state,
      data
    );

    state.conversationId =
      data.conversation_id ||
      state.conversationId;


    // ----------------------------------------------------------
    // Initial / snapshot message
    // ----------------------------------------------------------

    const message =
      getMessageFromDelta(
        data
      );


    if (
      message
    ) {

      diagnostics.initialMessageCount++;


      if (
        isFinalAssistantMessage(
          message
        )
      ) {

        diagnostics.finalAssistantMessageCount++;
      }


      startAssistantMessage(
        state,
        message,
        data.conversation_id
      );
    }


    // ----------------------------------------------------------
    // delta_encoding v1 string continuation
    // ----------------------------------------------------------

    handleDeltaV1String(
      state,
      data
    );


    // ----------------------------------------------------------
    // Patch
    // ----------------------------------------------------------

    handlePatch(
      state,
      data
    );
  }


  // ============================================================
  // Generic message events
  // ============================================================

  function handleMessageEvent(
    state,
    data
  ) {

    if (
      !data ||
      typeof data !==
      "object"
    ) {

      return;
    }


    state.conversationId =
      data.conversation_id ||
      state.conversationId;


    if (
      data.type ===
      "input_message"
    ) {

      handleInputMessage(
        state,
        data
      );

      return;
    }


    if (
      data.type ===
      "message_stream_complete"
    ) {

      state.streamCompleted =
        true;


      if (
        state.assistantStarted &&
        !state.assistantFinished
      ) {

        finishAssistant(
          state,
          "message_stream_complete"
        );
      }
    }
  }


  // ============================================================
  // Protocol dispatcher
  // ============================================================

  function handleSSEEvent(
    state,
    eventName,
    rawData
  ) {

    state.eventCount++;


    incrementCounter(
      state.diagnostics
        .sseEvents,
      eventName
    );


    // ----------------------------------------------------------
    // delta_encoding
    // ----------------------------------------------------------

    if (
      eventName ===
      "delta_encoding"
    ) {

      let encoding =
        rawData;


      try {

        encoding =
          JSON.parse(
            rawData
          );

      } catch {

        // Raw string is acceptable.
      }


      state.deltaEncoding =
        safeString(
          encoding
        );


      console.debug(
        PREFIX,
        "Delta encoding",
        {
          streamId:
            state.streamId,

          encoding:
            state.deltaEncoding
        }
      );


      return;
    }


    // ----------------------------------------------------------
    // [DONE]
    // ----------------------------------------------------------

    if (
      rawData ===
      "[DONE]"
    ) {

      state.doneReceived =
        true;


      if (
        state.assistantStarted &&
        !state.assistantFinished
      ) {

        finishAssistant(
          state,
          "done"
        );
      }


      return;
    }


    // ----------------------------------------------------------
    // JSON
    // ----------------------------------------------------------

    let data;


    try {

      data =
        JSON.parse(
          rawData
        );

    } catch {

      console.debug(
        PREFIX,
        "Ignoring non-JSON SSE event",
        {
          streamId:
            state.streamId,

          event:
            eventName
        }
      );


      return;
    }


    if (
      data == null
    ) {

      return;
    }


    if (
      eventName ===
      "delta"
    ) {

      handleDeltaEvent(
        state,
        data
      );

      return;
    }


    if (
      eventName ===
      "message"
    ) {

      handleMessageEvent(
        state,
        data
      );
    }
  }


  // ============================================================
  // Stream capture
  // ============================================================

  async function captureConversationStream(
    response,
    metadata
  ) {

    const streamId =
      createId(
        "stream"
      );


    const state =
      createStreamState(
        streamId
      );


    console.log(
      PREFIX,
      "STREAM START",
      {
        streamId,

        method:
          metadata.method,

        pathname:
          metadata.pathname,

        status:
          metadata.status,

        contentType:
          metadata.contentType,

        headersReceivedMs:
          metadata.headersReceivedMs
      }
    );


    emit(
      "conversation.stream.start",
      {
        streamId,

        pathname:
          metadata.pathname,

        status:
          metadata.status,

        contentType:
          metadata.contentType,

        headersReceivedMs:
          metadata.headersReceivedMs
      }
    );


    if (
      !response.body
    ) {

      const error =
        "Response body unavailable";


      console.error(
        PREFIX,
        "STREAM ERROR",
        {
          streamId,
          error
        }
      );


      emit(
        "conversation.stream.error",
        {
          streamId,
          error
        }
      );


      return;
    }


    const reader =
      response.body
        .getReader();


    const decoder =
      new TextDecoder();


    const parser =
      createSSEParser(
        ({
          event,
          data
        }) => {

          handleSSEEvent(
            state,
            event,
            data
          );
        }
      );


    let captureError =
      null;


    try {

      while (
        !state.doneReceived &&
        !state.streamCompleted
      ) {

        const {
          done,
          value
        } =
          await reader.read();


        if (
          done
        ) {

          break;
        }


        if (
          value
        ) {

          state.rawBytes +=
            value.byteLength;


          const chunk =
            decoder.decode(
              value,
              {
                stream:
                  true
              }
            );


          if (
            chunk
          ) {

            parser.push(
              chunk
            );
          }
        }
      }


      const finalChunk =
        decoder.decode();


      if (
        finalChunk
      ) {

        parser.push(
          finalChunk
        );
      }


      parser.flush();

    } catch (error) {

      captureError =
        safeError(
          error
        );


      const logicallyComplete =
        state.doneReceived ||
        state.streamCompleted ||
        state.assistantFinished;


      if (
        !logicallyComplete
      ) {

        console.error(
          PREFIX,
          "STREAM ERROR",
          {
            streamId,

            error:
              captureError
          }
        );


        emit(
          "conversation.stream.error",
          {
            streamId,

            conversationId:
              state.conversationId,

            requestId:
              state.requestId,

            messageId:
              state.assistantMessageId,

            error:
              captureError
          }
        );

      } else {

        console.debug(
          PREFIX,
          "Stream closed after logical completion",
          {
            streamId,

            error:
              captureError
          }
        );
      }

    } finally {

      try {

        reader.releaseLock();

      } catch {

        // Ignore.
      }
    }


    // ----------------------------------------------------------
    // Final safety completion
    // ----------------------------------------------------------

    if (
      state.assistantStarted &&
      !state.assistantFinished &&
      (
        state.doneReceived ||
        state.streamCompleted
      )
    ) {

      finishAssistant(
        state,
        "stream_complete"
      );
    }


    // ----------------------------------------------------------
    // Protocol diagnostics
    // ----------------------------------------------------------

    printProtocolDiagnostics(
      state,
      state.assistantFinished
        ? "assistant-finished"
        : "stream-ended"
    );


    const successful =
      state.assistantFinished;


    console.log(
      PREFIX,
      "STREAM COMPLETE",
      {
        streamId,

        conversationId:
          state.conversationId,

        requestId:
          state.requestId,

        messageId:
          state.assistantMessageId,

        encoding:
          state.deltaEncoding,

        eventCount:
          state.eventCount,

        deltaCount:
          state.deltaCount,

        rawBytes:
          state.rawBytes,

        responseLength:
          state.content.length,

        successful,

        captureError:
          successful
            ? null
            : captureError
      }
    );


    emit(
      "conversation.stream.complete",
      {
        streamId,

        conversationId:
          state.conversationId,

        requestId:
          state.requestId,

        turnExchangeId:
          state.turnExchangeId,

        messageId:
          state.assistantMessageId,

        encoding:
          state.deltaEncoding,

        eventCount:
          state.eventCount,

        deltaCount:
          state.deltaCount,

        rawBytes:
          state.rawBytes,

        responseLength:
          state.content.length,

        successful
      }
    );
  }


  // ============================================================
  // Fetch interceptor
  // ============================================================

  window.fetch =
    async function browserChatFetchInterceptor(
      input,
      init
    ) {

      const url =
        getRequestUrl(
          input
        );


      const method =
        getRequestMethod(
          input,
          init
        );


      const startedAt =
        performance.now();


      let response;


      try {

        response =
          await originalFetch.apply(
            this,
            arguments
          );

      } catch (error) {

        throw error;
      }


      if (
        !isConversationStream(
          url,
          method,
          response
        )
      ) {

        return response;
      }


      const metadata = {

        method,

        pathname:
          url.pathname,

        status:
          response.status,

        contentType:
          getContentType(
            response
          ),

        headersReceivedMs:
          Math.round(
            performance.now() -
            startedAt
          )
      };


      try {

        /*
         * Browser Chat consumes only the clone.
         *
         * ChatGPT keeps the original Response.
         */

        const clone =
          response.clone();


        void captureConversationStream(
          clone,
          metadata
        );

      } catch (error) {

        console.error(
          PREFIX,
          "Unable to clone conversation response",
          {
            error:
              safeError(
                error
              )
          }
        );


        emit(
          "conversation.stream.error",
          {
            streamId:
              null,

            error:
              safeError(
                error
              )
          }
        );
      }


      return response;
    };


  // ============================================================
  // Ready
  // ============================================================

  console.log(
    PREFIX,
    "Conversation SSE interceptor installed",
    {
      version:
        VERSION,

      endpoint:
        CONVERSATION_ENDPOINT
    }
  );


  emit(
    "network.interceptor.ready",
    {
      version:
        VERSION,

      endpoint:
        CONVERSATION_ENDPOINT
    }
  );
})();