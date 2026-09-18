// src/protocol/constants.js

/**
 * Browser Chat Provider Bridge
 * Protocol constants
 */

// ============================================================
// Protocol
// ============================================================

export const PROTOCOL_VERSION = 1;


// ============================================================
// Browser Chat Provider WebSocket
// ============================================================

export const DEFAULT_WS_URL =
  "ws://127.0.0.1:20128/browser-bridge";

export const DEFAULT_BRIDGE_ID =
  "chrome-main";

export const BRIDGE_VERSION =
  "0.1.0";


// ============================================================
// Message Types
// ============================================================

export const MESSAGE_TYPE = Object.freeze({
  REQUEST: "request",
  RESPONSE: "response",
  EVENT: "event",
  ERROR: "error"
});


// ============================================================
// Protocol Methods
// ============================================================

export const METHOD = Object.freeze({

  // ----------------------------------------------------------
  // Bridge
  // ----------------------------------------------------------

  BRIDGE_REGISTER: "bridge.register",

  BRIDGE_REGISTERED: "bridge.registered",

  BRIDGE_HEARTBEAT: "bridge.heartbeat",

  BRIDGE_STATUS: "bridge.status",


  // ----------------------------------------------------------
  // Agent
  // ----------------------------------------------------------

  AGENT_REGISTER: "agent.register",

  AGENT_UNREGISTER: "agent.unregister",

  AGENT_STATUS: "agent.status",

  AGENT_LIST: "agent.list",


  // ----------------------------------------------------------
  // Chat
  // ----------------------------------------------------------

  CHAT_SEND: "chat.send",

  CHAT_DELTA: "chat.delta",

  CHAT_COMPLETED: "chat.completed",

  CHAT_CANCEL: "chat.cancel",

  CHAT_ERROR: "chat.error"

});


// ============================================================
// Bridge Status
// ============================================================

export const BRIDGE_STATUS = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  REGISTERING: "registering",
  READY: "ready",
  ERROR: "error"
});


// ============================================================
// Agent Status
// ============================================================

export const AGENT_STATUS = Object.freeze({
  OFFLINE: "offline",
  IDLE: "idle",
  SENDING: "sending",
  GENERATING: "generating",
  COMPLETED: "completed",
  CANCELED: "canceled",
  ERROR: "error"
});


// ============================================================
// Request Status
// ============================================================

export const REQUEST_STATUS = Object.freeze({
  PENDING: "pending",
  QUEUED: "queued",
  SENDING: "sending",
  GENERATING: "generating",
  COMPLETED: "completed",
  CANCELED: "canceled",
  TIMEOUT: "timeout",
  ERROR: "error"
});


// ============================================================
// Providers
// ============================================================

export const PROVIDER = Object.freeze({
  CHATGPT: "chatgpt-web"
});


// ============================================================
// Provider capabilities
// ============================================================

export const CAPABILITY = Object.freeze({
  TEXT: "text",
  STREAM: "stream",
  CANCEL: "cancel",
  TAB_DISCOVERY: "tab.discovery"
});


// ============================================================
// Internal Chrome Extension Messages
// ============================================================

export const INTERNAL_MESSAGE = Object.freeze({
  CHAT_SEND: "CHAT_SEND",
  CHAT_CANCEL: "CHAT_CANCEL",

  CHAT_STARTED: "CHAT_STARTED",
  CHAT_DELTA: "CHAT_DELTA",
  CHAT_COMPLETED: "CHAT_COMPLETED",
  CHAT_ERROR: "CHAT_ERROR",

  PROVIDER_DETECTED: "PROVIDER_DETECTED",
  PROVIDER_STATUS: "PROVIDER_STATUS",

  GET_BRIDGE_STATUS: "GET_BRIDGE_STATUS",
  GET_CURRENT_AGENT: "GET_CURRENT_AGENT",
  GET_AGENTS: "GET_AGENTS",

  REGISTER_AGENT: "REGISTER_AGENT",
  UNREGISTER_AGENT: "UNREGISTER_AGENT"
});


// ============================================================
// Timing
// ============================================================

export const HEARTBEAT_INTERVAL_MS = 15_000;

export const RECONNECT_INITIAL_DELAY_MS = 1_000;

export const RECONNECT_MAX_DELAY_MS = 30_000;

export const CHAT_REQUEST_TIMEOUT_MS = 180_000;


// ============================================================
// WebSocket
// ============================================================

export const WS_READY_STATE = Object.freeze({
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
});


// ============================================================
// Storage Keys
// ============================================================

export const STORAGE_KEY = Object.freeze({
  WS_URL: "browserChatBridge.wsUrl",
  BRIDGE_ID: "browserChatBridge.bridgeId",
  BRIDGE_TOKEN: "browserChatBridge.token",
  AGENTS: "browserChatBridge.agents"
});


// ============================================================
// Defaults
// ============================================================

export const DEFAULT_CONFIG = Object.freeze({
  wsUrl: DEFAULT_WS_URL,
  bridgeId: DEFAULT_BRIDGE_ID,
  heartbeatInterval: HEARTBEAT_INTERVAL_MS,
  requestTimeout: CHAT_REQUEST_TIMEOUT_MS
});
