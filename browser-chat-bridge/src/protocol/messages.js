// src/protocol/messages.js

import {
  PROTOCOL_VERSION,
  MESSAGE_TYPE
} from "./constants.js";

/**
 * Generate unique message/request ID.
 *
 * Example:
 * req_1723456789123_a8f31c2d
 */
export function generateId(prefix = "msg") {
  const timestamp = Date.now();

  const random = crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

  return `${prefix}_${timestamp}_${random}`;
}


/**
 * Current Unix timestamp in milliseconds.
 */
export function now() {
  return Date.now();
}


/**
 * Create base protocol envelope.
 */
function createEnvelope(type) {
  return {
    v: PROTOCOL_VERSION,
    type,
    timestamp: now()
  };
}


// ============================================================
// Request
// ============================================================

/**
 * Create request message.
 *
 * Example:
 *
 * createRequest("chat.send", {
 *   agentId: "architect",
 *   message: {
 *     role: "user",
 *     content: "Review this architecture"
 *   }
 * });
 */
export function createRequest(
  method,
  payload = {},
  id = null
) {
  if (!method) {
    throw new Error("Request method is required");
  }

  return {
    ...createEnvelope(MESSAGE_TYPE.REQUEST),

    id: id || generateId("req"),

    method,

    payload
  };
}


// ============================================================
// Response
// ============================================================

/**
 * Create response message for an existing request.
 *
 * IMPORTANT:
 * response.id must equal request.id.
 */
export function createResponse(
  requestId,
  result = {}
) {
  if (!requestId) {
    throw new Error("requestId is required");
  }

  return {
    ...createEnvelope(MESSAGE_TYPE.RESPONSE),

    id: requestId,

    result
  };
}


// ============================================================
// Event
// ============================================================

/**
 * Create asynchronous event.
 *
 * Events do not require a response.
 *
 * Example:
 *
 * createEvent("chat.delta", {
 *   requestId: "...",
 *   delta: "Hello"
 * });
 */
export function createEvent(
  method,
  payload = {}
) {
  if (!method) {
    throw new Error("Event method is required");
  }

  return {
    ...createEnvelope(MESSAGE_TYPE.EVENT),

    id: generateId("evt"),

    method,

    payload
  };
}


// ============================================================
// Error
// ============================================================

/**
 * Create protocol error.
 *
 * requestId can be null for errors that are not associated
 * with a particular request.
 */
export function createError(
  requestId,
  code,
  message,
  details = null
) {
  if (!code) {
    throw new Error("Error code is required");
  }

  if (!message) {
    throw new Error("Error message is required");
  }

  const error = {
    code,
    message
  };

  if (details !== null && details !== undefined) {
    error.details = details;
  }

  return {
    ...createEnvelope(MESSAGE_TYPE.ERROR),

    id: requestId || generateId("err"),

    error
  };
}


// ============================================================
// Bridge helpers
// ============================================================

/**
 * Create bridge.register request.
 */
export function createBridgeRegister({
  bridgeId,
  name,
  bridgeVersion,
  capabilities = []
}) {
  if (!bridgeId) {
    throw new Error("bridgeId is required");
  }

  if (!bridgeVersion) {
    throw new Error("bridgeVersion is required");
  }

  return createRequest(
    "bridge.register",
    {
      bridgeId,
      name,
      bridgeVersion,
      capabilities
    },
    generateId("reg")
  );
}


/**
 * Create bridge heartbeat event.
 */
export function createHeartbeat(
  bridgeId
) {
  if (!bridgeId) {
    throw new Error("bridgeId is required");
  }

  return createEvent(
    "bridge.heartbeat",
    {
      bridgeId,
      timestamp: now()
    }
  );
}


// ============================================================
// Agent helpers
// ============================================================

/**
 * Create agent.register event.
 */
export function createAgentRegister({
  bridgeId,
  agentId,
  provider,
  tabId,
  conversationId = null,
  title = null,
  status = "idle",
  capabilities = []
}) {
  return createEvent(
    "agent.register",
    {
      bridgeId,
      agentId,
      provider,
      tabId,
      conversationId,
      title,
      status,
      capabilities
    }
  );
}


/**
 * Create agent.unregister event.
 */
export function createAgentUnregister(
  bridgeId,
  agentId,
  reason = null
) {
  return createEvent(
    "agent.unregister",
    {
      bridgeId,
      agentId,
      ...(reason
        ? { reason }
        : {})
    }
  );
}


/**
 * Create agent status event.
 */
export function createAgentStatus(
  agentId,
  status,
  extra = {}
) {
  if (!agentId) {
    throw new Error("agentId is required");
  }

  if (!status) {
    throw new Error("status is required");
  }

  return createEvent(
    "agent.status",
    {
      agentId,
      status,
      ...extra
    }
  );
}


// ============================================================
// Chat helpers
// ============================================================

/**
 * Create streaming delta event.
 */
export function createChatDelta({
  requestId,
  agentId,
  seq,
  delta
}) {
  if (!requestId) {
    throw new Error("requestId is required");
  }

  if (!agentId) {
    throw new Error("agentId is required");
  }

  return createEvent(
    "chat.delta",
    {
      requestId,
      agentId,
      seq,
      delta
    }
  );
}


/**
 * Create chat completion response.
 *
 * The response ID is the original chat.send request ID.
 */
export function createChatCompleted({
  requestId,
  agentId,
  content,
  conversationId = null,
  durationMs = null
}) {
  if (!requestId) {
    throw new Error("requestId is required");
  }

  if (!agentId) {
    throw new Error("agentId is required");
  }

  return createResponse(
    requestId,
    {
      agentId,
      status: "completed",
      content,
      conversationId,
      durationMs
    }
  );
}


// ============================================================
// Serialization
// ============================================================

/**
 * Convert protocol message to JSON string.
 */
export function serializeMessage(
  message
) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid message");
  }

  return JSON.stringify(message);
}


/**
 * Parse protocol message from JSON string.
 */
export function parseMessage(
  raw
) {
  if (typeof raw !== "string") {
    throw new Error("Protocol message must be a string");
  }

  let message;

  try {
    message = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON message: ${error.message}`
    );
  }

  return message;
}