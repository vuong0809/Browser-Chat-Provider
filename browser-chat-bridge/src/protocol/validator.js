// src/protocol/validator.js

import {
  PROTOCOL_VERSION,
  MESSAGE_TYPE,
  METHOD
} from "./constants.js";


// ============================================================
// Helpers
// ============================================================

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function isValidTimestamp(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
}


// ============================================================
// Supported values
// ============================================================

const VALID_MESSAGE_TYPES = new Set(
  Object.values(MESSAGE_TYPE)
);


const VALID_METHODS = new Set(
  Object.values(METHOD)
);


// ============================================================
// Validation result
// ============================================================

function success(message) {
  return {
    valid: true,
    message,
    errors: []
  };
}


function failure(errors) {
  return {
    valid: false,
    message: null,
    errors: Array.isArray(errors)
      ? errors
      : [errors]
  };
}


// ============================================================
// Base envelope validation
// ============================================================

function validateEnvelope(message) {
  const errors = [];

  if (!isObject(message)) {
    return ["Message must be an object"];
  }

  // Protocol version
  if (message.v !== PROTOCOL_VERSION) {
    errors.push(
      `Unsupported protocol version: ${message.v}`
    );
  }

  // Message type
  if (!VALID_MESSAGE_TYPES.has(message.type)) {
    errors.push(
      `Invalid message type: ${message.type}`
    );
  }

  // Timestamp
  if (!isValidTimestamp(message.timestamp)) {
    errors.push(
      "Message timestamp must be a valid number"
    );
  }

  // ID
  if (!isNonEmptyString(message.id)) {
    errors.push(
      "Message id is required"
    );
  }

  return errors;
}


// ============================================================
// Request validation
// ============================================================

function validateRequest(message) {
  const errors = [];

  if (!isNonEmptyString(message.method)) {
    errors.push(
      "Request method is required"
    );

    return errors;
  }

  if (!VALID_METHODS.has(message.method)) {
    errors.push(
      `Unsupported request method: ${message.method}`
    );
  }

  if (
    message.payload !== undefined &&
    !isObject(message.payload)
  ) {
    errors.push(
      "Request payload must be an object"
    );
  }

  return errors;
}


// ============================================================
// Response validation
// ============================================================

function validateResponse(message) {
  const errors = [];

  if (
    message.result !== undefined &&
    !isObject(message.result)
  ) {
    errors.push(
      "Response result must be an object"
    );
  }

  return errors;
}


// ============================================================
// Event validation
// ============================================================

function validateEvent(message) {
  const errors = [];

  if (!isNonEmptyString(message.method)) {
    errors.push(
      "Event method is required"
    );

    return errors;
  }

  if (!VALID_METHODS.has(message.method)) {
    errors.push(
      `Unsupported event method: ${message.method}`
    );
  }

  if (
    message.payload !== undefined &&
    !isObject(message.payload)
  ) {
    errors.push(
      "Event payload must be an object"
    );
  }

  return errors;
}


// ============================================================
// Error validation
// ============================================================

function validateError(message) {
  const errors = [];

  if (!isObject(message.error)) {
    errors.push(
      "Error message must contain an error object"
    );

    return errors;
  }

  if (!isNonEmptyString(message.error.code)) {
    errors.push(
      "Error code is required"
    );
  }

  if (!isNonEmptyString(message.error.message)) {
    errors.push(
      "Error message is required"
    );
  }

  return errors;
}


// ============================================================
// Method-specific payload validation
// ============================================================

function validateChatSendPayload(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return [
      "chat.send payload must be an object"
    ];
  }

  if (!isNonEmptyString(payload.agentId)) {
    errors.push(
      "chat.send requires agentId"
    );
  }

  if (!isObject(payload.message)) {
    errors.push(
      "chat.send requires message object"
    );

    return errors;
  }

  if (!isNonEmptyString(payload.message.content)) {
    errors.push(
      "chat.send message.content is required"
    );
  }

  if (
    payload.message.role !== undefined &&
    payload.message.role !== "user"
  ) {
    errors.push(
      "chat.send message.role must be 'user'"
    );
  }

  if (
    payload.options !== undefined &&
    !isObject(payload.options)
  ) {
    errors.push(
      "chat.send options must be an object"
    );
  }

  return errors;
}


function validateChatCancelPayload(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return [
      "chat.cancel payload must be an object"
    ];
  }

  if (!isNonEmptyString(payload.requestId)) {
    errors.push(
      "chat.cancel requires requestId"
    );
  }

  return errors;
}


function validateBridgeRegisterPayload(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return [
      "bridge.register payload must be an object"
    ];
  }

  if (!isNonEmptyString(payload.bridgeId)) {
    errors.push(
      "bridge.register requires bridgeId"
    );
  }

  return errors;
}


function validateAgentPayload(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return [
      "Agent payload must be an object"
    ];
  }

  if (!isNonEmptyString(payload.agentId)) {
    errors.push(
      "Agent message requires agentId"
    );
  }

  return errors;
}


// ============================================================
// Method dispatcher
// ============================================================

function validateMethodPayload(message) {
  const payload = message.payload ?? {};

  switch (message.method) {

    case METHOD.CHAT_SEND:
      return validateChatSendPayload(payload);

    case METHOD.CHAT_CANCEL:
      return validateChatCancelPayload(payload);

    case METHOD.BRIDGE_REGISTER:
      return validateBridgeRegisterPayload(payload);

    case METHOD.AGENT_REGISTER:
    case METHOD.AGENT_UNREGISTER:
    case METHOD.AGENT_STATUS:
      return validateAgentPayload(payload);

    default:
      return [];
  }
}


// ============================================================
// Main validator
// ============================================================

export function validateMessage(message) {
  const errors = [];

  // ----------------------------------------------------------
  // Envelope
  // ----------------------------------------------------------

  errors.push(
    ...validateEnvelope(message)
  );

  if (errors.length > 0) {
    return failure(errors);
  }


  // ----------------------------------------------------------
  // Type
  // ----------------------------------------------------------

  switch (message.type) {

    case MESSAGE_TYPE.REQUEST:
      errors.push(
        ...validateRequest(message)
      );
      break;


    case MESSAGE_TYPE.RESPONSE:
      errors.push(
        ...validateResponse(message)
      );
      break;


    case MESSAGE_TYPE.EVENT:
      errors.push(
        ...validateEvent(message)
      );
      break;


    case MESSAGE_TYPE.ERROR:
      errors.push(
        ...validateError(message)
      );
      break;


    default:
      errors.push(
        `Unknown message type: ${message.type}`
      );
  }


  // ----------------------------------------------------------
  // Method payload
  // ----------------------------------------------------------

  if (
    message.type === MESSAGE_TYPE.REQUEST ||
    message.type === MESSAGE_TYPE.EVENT
  ) {
    errors.push(
      ...validateMethodPayload(message)
    );
  }


  if (errors.length > 0) {
    return failure(errors);
  }

  return success(message);
}


// ============================================================
// JSON parser + validator
// ============================================================

export function parseAndValidateMessage(raw) {
  let message;

  try {
    message = JSON.parse(raw);
  } catch (error) {
    return failure(
      `Invalid JSON: ${error.message}`
    );
  }

  return validateMessage(message);
}


// ============================================================
// Convenience helper
// ============================================================

export function assertValidMessage(message) {
  const result = validateMessage(message);

  if (!result.valid) {
    throw new Error(
      `Invalid protocol message: ${result.errors.join("; ")}`
    );
  }

  return result.message;
}