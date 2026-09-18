// browser-chat/protocol/constants.ts


// ============================================================
// Protocol
// ============================================================

export const PROTOCOL_VERSION =
    1 as const;


export const BROWSER_CHAT_SERVER_VERSION =
    "0.1.0";


export const DEFAULT_BRIDGE_ID =
    "chrome-main";


export const DEFAULT_WS_HOST =
    "127.0.0.1";


export const DEFAULT_WS_PORT =
    20128;


export const DEFAULT_WS_PATH =
    "/browser-bridge";


export const DEFAULT_WS_URL =
    `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}${DEFAULT_WS_PATH}`;


// ============================================================
// Message types
// ============================================================

export const MESSAGE_TYPE = {
    REQUEST: "request",
    RESPONSE: "response",
    EVENT: "event",
    ERROR: "error"
} as const;


export type MessageType =
    typeof MESSAGE_TYPE[
        keyof typeof MESSAGE_TYPE
    ];


// ============================================================
// Methods
// ============================================================

export const METHOD = {

    // --------------------------------------------------------
    // Bridge
    // --------------------------------------------------------

    BRIDGE_REGISTER:
        "bridge.register",

    BRIDGE_REGISTERED:
        "bridge.registered",

    BRIDGE_HEARTBEAT:
        "bridge.heartbeat",

    BRIDGE_STATUS:
        "bridge.status",


    // --------------------------------------------------------
    // Agent
    // --------------------------------------------------------

    AGENT_REGISTER:
        "agent.register",

    AGENT_UNREGISTER:
        "agent.unregister",

    AGENT_STATUS:
        "agent.status",

    AGENT_LIST:
        "agent.list",


    // --------------------------------------------------------
    // Chat
    // --------------------------------------------------------

    CHAT_SEND:
        "chat.send",

    CHAT_DELTA:
        "chat.delta",

    CHAT_COMPLETED:
        "chat.completed",

    CHAT_CANCEL:
        "chat.cancel",

    CHAT_ERROR:
        "chat.error"

} as const;


export type BrowserChatMethod =
    typeof METHOD[
        keyof typeof METHOD
    ];


// ============================================================
// Bridge status
// ============================================================

export const BRIDGE_STATUS = {
    DISCONNECTED: "disconnected",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    REGISTERING: "registering",
    READY: "ready",
    ERROR: "error"
} as const;


export type BridgeStatus =
    typeof BRIDGE_STATUS[
        keyof typeof BRIDGE_STATUS
    ];


// ============================================================
// Agent status
// ============================================================

export const AGENT_STATUS = {
    OFFLINE: "offline",
    IDLE: "idle",
    SENDING: "sending",
    GENERATING: "generating",
    COMPLETED: "completed",
    CANCELED: "canceled",
    ERROR: "error"
} as const;


export type AgentStatus =
    typeof AGENT_STATUS[
        keyof typeof AGENT_STATUS
    ];


// ============================================================
// Request status
// ============================================================

export const REQUEST_STATUS = {
    PENDING: "pending",
    QUEUED: "queued",
    SENDING: "sending",
    GENERATING: "generating",
    COMPLETED: "completed",
    CANCELED: "canceled",
    TIMEOUT: "timeout",
    ERROR: "error"
} as const;


export type RequestStatus =
    typeof REQUEST_STATUS[
        keyof typeof REQUEST_STATUS
    ];


// ============================================================
// Providers
// ============================================================

export const PROVIDER = {
    CHATGPT: "chatgpt-web"
} as const;


export type ProviderId =
    typeof PROVIDER[
        keyof typeof PROVIDER
    ];


// ============================================================
// Capabilities
// ============================================================

export const CAPABILITY = {
    TEXT: "text",
    STREAM: "stream",
    CANCEL: "cancel",
    TAB_DISCOVERY: "tab-discovery"
} as const;


export type Capability =
    typeof CAPABILITY[
        keyof typeof CAPABILITY
    ];


// ============================================================
// Default bridge capabilities
// ============================================================

export const DEFAULT_BRIDGE_CAPABILITIES = [
    CAPABILITY.TEXT,
    CAPABILITY.STREAM,
    CAPABILITY.CANCEL,
    CAPABILITY.TAB_DISCOVERY
] as const;


// ============================================================
// Timeouts
// ============================================================

/*
 * Default time allowed for one browser chat request.
 *
 * ChatGPT can take considerably longer than normal HTTP/API
 * requests, so V1 uses 180 seconds.
 */

export const DEFAULT_REQUEST_TIMEOUT_MS =
    180_000;


/*
 * Minimum timeout accepted from callers.
 */

export const MIN_REQUEST_TIMEOUT_MS =
    5_000;


/*
 * Maximum timeout accepted from callers.
 *
 * Prevents accidental requests waiting indefinitely.
 */

export const MAX_REQUEST_TIMEOUT_MS =
    600_000;


// ============================================================
// Heartbeat
// ============================================================

export const DEFAULT_HEARTBEAT_INTERVAL_MS =
    15_000;


/*
 * A bridge can miss several heartbeat intervals before it is
 * considered stale.
 *
 * MV3 service workers can be suspended, therefore this must not
 * be too aggressive.
 */

export const BRIDGE_STALE_TIMEOUT_MS =
    60_000;


// ============================================================
// Reconnect
// ============================================================

export const RECONNECT_INITIAL_DELAY_MS =
    1_000;


export const RECONNECT_MAX_DELAY_MS =
    30_000;


export const RECONNECT_BACKOFF_FACTOR =
    2;


export const RECONNECT_JITTER_RATIO =
    0.20;


// ============================================================
// Queue
// ============================================================

export const DEFAULT_REQUEST_QUEUE_SIZE =
    100;


export const DEFAULT_OUTBOUND_QUEUE_SIZE =
    100;


// ============================================================
// Limits
// ============================================================

export const MAX_AGENT_ID_LENGTH =
    64;


export const MAX_MESSAGE_LENGTH =
    200_000;


export const MAX_ERROR_MESSAGE_LENGTH =
    4_096;


// ============================================================
// Agent ID
// ============================================================

export const AGENT_ID_PATTERN =
    /^[a-zA-Z0-9_-]+$/;


// ============================================================
// Error codes
// ============================================================

export const ERROR_CODE = {

    // --------------------------------------------------------
    // Protocol
    // --------------------------------------------------------

    INVALID_MESSAGE:
        "INVALID_MESSAGE",

    INVALID_ENVELOPE:
        "INVALID_ENVELOPE",

    INVALID_PAYLOAD:
        "INVALID_PAYLOAD",

    UNSUPPORTED_VERSION:
        "UNSUPPORTED_VERSION",

    UNSUPPORTED_TYPE:
        "UNSUPPORTED_TYPE",

    UNSUPPORTED_METHOD:
        "UNSUPPORTED_METHOD",


    // --------------------------------------------------------
    // Bridge
    // --------------------------------------------------------

    BRIDGE_NOT_REGISTERED:
        "BRIDGE_NOT_REGISTERED",

    BRIDGE_NOT_FOUND:
        "BRIDGE_NOT_FOUND",

    BRIDGE_OFFLINE:
        "BRIDGE_OFFLINE",

    BRIDGE_ALREADY_REGISTERED:
        "BRIDGE_ALREADY_REGISTERED",

    BRIDGE_AUTH_FAILED:
        "BRIDGE_AUTH_FAILED",


    // --------------------------------------------------------
    // Agent
    // --------------------------------------------------------

    AGENT_NOT_FOUND:
        "AGENT_NOT_FOUND",

    AGENT_OFFLINE:
        "AGENT_OFFLINE",

    AGENT_BUSY:
        "AGENT_BUSY",

    AGENT_ALREADY_EXISTS:
        "AGENT_ALREADY_EXISTS",

    INVALID_AGENT_ID:
        "INVALID_AGENT_ID",


    // --------------------------------------------------------
    // Request
    // --------------------------------------------------------

    REQUEST_NOT_FOUND:
        "REQUEST_NOT_FOUND",

    REQUEST_MISMATCH:
        "REQUEST_MISMATCH",

    REQUEST_TIMEOUT:
        "REQUEST_TIMEOUT",

    REQUEST_CANCELED:
        "REQUEST_CANCELED",

    REQUEST_QUEUE_FULL:
        "REQUEST_QUEUE_FULL",


    // --------------------------------------------------------
    // Transport
    // --------------------------------------------------------

    CONNECTION_CLOSED:
        "CONNECTION_CLOSED",

    SEND_FAILED:
        "SEND_FAILED",


    // --------------------------------------------------------
    // Internal
    // --------------------------------------------------------

    INTERNAL_ERROR:
        "INTERNAL_ERROR"

} as const;


export type ErrorCode =
    typeof ERROR_CODE[
        keyof typeof ERROR_CODE
    ];


// ============================================================
// WebSocket ready state
// ============================================================

/*
 * Keep these values independent from the ws implementation.
 *
 * Browser WebSocket and the Node "ws" package use the same
 * numeric ready-state values.
 */

export const WS_READY_STATE = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
} as const;


// ============================================================
// WebSocket close codes
// ============================================================

export const WS_CLOSE_CODE = {
    NORMAL: 1000,
    GOING_AWAY: 1001,
    PROTOCOL_ERROR: 1002,
    POLICY_VIOLATION: 1008,
    INTERNAL_ERROR: 1011
} as const;


// ============================================================
// Internal events
// ============================================================

/*
 * These are local 9Router events.
 *
 * They are NOT part of the Browser Chat wire protocol.
 */

export const INTERNAL_EVENT = {

    BRIDGE_CONNECTED:
        "bridge-connected",

    BRIDGE_REGISTERED:
        "bridge-registered",

    BRIDGE_DISCONNECTED:
        "bridge-disconnected",

    BRIDGE_STALE:
        "bridge-stale",

    AGENT_REGISTERED:
        "agent-registered",

    AGENT_UNREGISTERED:
        "agent-unregistered",

    AGENT_STATUS_CHANGED:
        "agent-status-changed",

    REQUEST_CREATED:
        "request-created",

    REQUEST_STARTED:
        "request-started",

    REQUEST_DELTA:
        "request-delta",

    REQUEST_COMPLETED:
        "request-completed",

    REQUEST_CANCELED:
        "request-canceled",

    REQUEST_TIMEOUT:
        "request-timeout",

    REQUEST_ERROR:
        "request-error"

} as const;


// ============================================================
// Defaults
// ============================================================

export const DEFAULT_CONFIG = {

    host:
        DEFAULT_WS_HOST,

    port:
        DEFAULT_WS_PORT,

    path:
        DEFAULT_WS_PATH,

    serverVersion:
        BROWSER_CHAT_SERVER_VERSION,

    requestTimeoutMs:
        DEFAULT_REQUEST_TIMEOUT_MS,

    heartbeatIntervalMs:
        DEFAULT_HEARTBEAT_INTERVAL_MS,

    bridgeStaleTimeoutMs:
        BRIDGE_STALE_TIMEOUT_MS,

    requestQueueSize:
        DEFAULT_REQUEST_QUEUE_SIZE,

    outboundQueueSize:
        DEFAULT_OUTBOUND_QUEUE_SIZE

} as const;