// browser-chat/protocol/types.ts


// ============================================================
// Protocol primitives
// ============================================================

export type ProtocolVersion = 1;


export type MessageType =
    | "request"
    | "response"
    | "event"
    | "error";


// ============================================================
// Methods
// ============================================================

export type BridgeMethod =
    | "bridge.register"
    | "bridge.registered"
    | "bridge.heartbeat"
    | "bridge.status";


export type AgentMethod =
    | "agent.register"
    | "agent.unregister"
    | "agent.status"
    | "agent.list";


export type ChatMethod =
    | "chat.send"
    | "chat.delta"
    | "chat.completed"
    | "chat.cancel"
    | "chat.error";


export type BrowserChatMethod =
    | BridgeMethod
    | AgentMethod
    | ChatMethod;


// ============================================================
// Provider
// ============================================================

export type ProviderId =
    | "chatgpt-web"
    | (string & {});


// ============================================================
// Capabilities
// ============================================================

export type Capability =
    | "text"
    | "stream"
    | "cancel"
    | "tab-discovery"
    | (string & {});


// ============================================================
// Bridge status
// ============================================================

export type BridgeStatus =
    | "disconnected"
    | "connecting"
    | "connected"
    | "registering"
    | "ready"
    | "error";


// ============================================================
// Agent status
// ============================================================

export type AgentStatus =
    | "offline"
    | "idle"
    | "sending"
    | "generating"
    | "completed"
    | "canceled"
    | "error";


// ============================================================
// Request status
// ============================================================

export type RequestStatus =
    | "pending"
    | "queued"
    | "sending"
    | "generating"
    | "completed"
    | "canceled"
    | "timeout"
    | "error";


// ============================================================
// Base protocol envelope
// ============================================================

export interface BaseEnvelope {

    v: ProtocolVersion;

    type: MessageType;

    id: string;

    timestamp: number;
}


// ============================================================
// Request envelope
// ============================================================

export interface RequestEnvelope<
    TMethod extends BrowserChatMethod =
        BrowserChatMethod,
    TPayload = unknown
> extends BaseEnvelope {

    type: "request";

    method: TMethod;

    payload: TPayload;
}


// ============================================================
// Response envelope
// ============================================================

export interface ResponseEnvelope<
    TResult = unknown
> extends BaseEnvelope {

    type: "response";

    result: TResult;
}


// ============================================================
// Event envelope
// ============================================================

export interface EventEnvelope<
    TMethod extends BrowserChatMethod =
        BrowserChatMethod,
    TPayload = unknown
> extends BaseEnvelope {

    type: "event";

    method: TMethod;

    payload: TPayload;
}


// ============================================================
// Error envelope
// ============================================================

export interface ErrorData {

    code: string;

    message: string;

    details?: unknown;
}


export interface ErrorEnvelope
    extends BaseEnvelope {

    type: "error";

    error: ErrorData;
}


// ============================================================
// Any envelope
// ============================================================

export type BrowserChatEnvelope =
    | RequestEnvelope
    | ResponseEnvelope
    | EventEnvelope
    | ErrorEnvelope;


// ============================================================
// Bridge registration
// ============================================================

export interface BridgeRegisterPayload {

    bridgeId: string;

    bridgeVersion: string;

    capabilities: Capability[];

    token?: string;
}


export type BridgeRegisterRequest =
    RequestEnvelope<
        "bridge.register",
        BridgeRegisterPayload
    >;


// ============================================================
// Bridge registered
// ============================================================

export interface BridgeRegisteredResult {

    bridgeId: string;

    accepted: boolean;

    heartbeatIntervalMs?: number;

    serverVersion?: string;

    message?: string;
}


export type BridgeRegisteredResponse =
    ResponseEnvelope<
        BridgeRegisteredResult
    >;


// ============================================================
// Bridge heartbeat
// ============================================================

export interface BridgeHeartbeatPayload {

    bridgeId: string;

    status?: BridgeStatus;

    agentCount?: number;
}


export type BridgeHeartbeatEvent =
    EventEnvelope<
        "bridge.heartbeat",
        BridgeHeartbeatPayload
    >;


// ============================================================
// Bridge status
// ============================================================

export interface BridgeStatusPayload {

    bridgeId: string;

    status: BridgeStatus;

    connectedAt?: number;

    lastHeartbeatAt?: number;

    agentCount?: number;

    error?: string;
}


export type BridgeStatusEvent =
    EventEnvelope<
        "bridge.status",
        BridgeStatusPayload
    >;


// ============================================================
// Agent
// ============================================================

export interface BrowserChatAgent {

    agentId: string;

    provider: ProviderId;

    bridgeId?: string;

    tabId?: number;

    conversationId?: string | null;

    title?: string | null;

    status: AgentStatus;

    capabilities: Capability[];

    activeRequestId?: string | null;

    createdAt?: number;

    updatedAt?: number;

    lastSeenAt?: number;
}


// ============================================================
// Agent register
// ============================================================

export interface AgentRegisterPayload {

    bridgeId: string;

    agentId: string;

    provider: ProviderId;

    conversationId?: string | null;

    title?: string | null;

    capabilities?: Capability[];

    status?: AgentStatus;
}


export type AgentRegisterEvent =
    EventEnvelope<
        "agent.register",
        AgentRegisterPayload
    >;


// ============================================================
// Agent unregister
// ============================================================

export interface AgentUnregisterPayload {

    bridgeId: string;

    agentId: string;

    reason?: string;
}


export type AgentUnregisterEvent =
    EventEnvelope<
        "agent.unregister",
        AgentUnregisterPayload
    >;


// ============================================================
// Agent status
// ============================================================

export interface AgentStatusPayload {

    bridgeId?: string;

    agentId: string;

    status: AgentStatus;

    requestId?: string | null;

    conversationId?: string | null;

    title?: string | null;

    error?: string;
}


export type AgentStatusEvent =
    EventEnvelope<
        "agent.status",
        AgentStatusPayload
    >;


// ============================================================
// Agent list
// ============================================================

export interface AgentListPayload {

    bridgeId?: string;
}


export type AgentListRequest =
    RequestEnvelope<
        "agent.list",
        AgentListPayload
    >;


export interface AgentListResult {

    agents: BrowserChatAgent[];
}


export type AgentListResponse =
    ResponseEnvelope<
        AgentListResult
    >;


// ============================================================
// Chat message
// ============================================================

export type ChatRole =
    | "user"
    | "assistant"
    | "system";


export interface ChatMessage {

    role: ChatRole;

    content: string;
}


// ============================================================
// Chat send
// ============================================================

export interface ChatSendOptions {

    stream?: boolean;

    timeout?: number;
}


export interface ChatSendPayload {

    agentId: string;

    message: ChatMessage;

    options?: ChatSendOptions;
}


export type ChatSendRequest =
    RequestEnvelope<
        "chat.send",
        ChatSendPayload
    >;


// ============================================================
// Chat started
// ============================================================

/*
 * There is intentionally no "chat.started" wire method in V1.
 *
 * The extension reports generation progress using:
 *
 * agent.status = generating
 *
 * followed by chat.delta / chat.completed.
 */


// ============================================================
// Chat delta
// ============================================================

export interface ChatDeltaPayload {

    requestId: string;

    agentId: string;

    seq: number;

    delta: string;

    /*
     * Optional fields already produced by the content layer.
     *
     * fullText:
     * Current complete assistant text.
     *
     * replace:
     * true when the provider rewrote previous DOM text and the
     * consumer should replace accumulated text rather than append.
     */

    fullText?: string;

    replace?: boolean;
}


export type ChatDeltaEvent =
    EventEnvelope<
        "chat.delta",
        ChatDeltaPayload
    >;


// ============================================================
// Chat completed
// ============================================================

export interface ChatCompletedResult {

    agentId: string;

    status: "completed";

    content: string;

    conversationId?: string | null;

    title?: string | null;

    durationMs?: number;
}


export type ChatCompletedResponse =
    ResponseEnvelope<
        ChatCompletedResult
    >;


// ============================================================
// Chat cancel
// ============================================================

export interface ChatCancelPayload {

    requestId: string;

    agentId?: string;
}


export type ChatCancelRequest =
    RequestEnvelope<
        "chat.cancel",
        ChatCancelPayload
    >;


// ============================================================
// Chat error
// ============================================================

export interface ChatErrorPayload {

    requestId: string;

    agentId: string;

    code?: string;

    message: string;

    details?: unknown;
}


export type ChatErrorEvent =
    EventEnvelope<
        "chat.error",
        ChatErrorPayload
    >;


// ============================================================
// Internal bridge connection
// ============================================================

/*
 * These types are NOT sent over the wire.
 *
 * They are runtime records used by the Browser Chat Provider
 * module.
 */

export interface BridgeConnection {

    bridgeId: string;

    status: BridgeStatus;

    connectedAt: number;

    lastSeenAt: number;

    capabilities: Capability[];

    bridgeVersion?: string;

    remoteAddress?: string;
}


// ============================================================
// Internal request record
// ============================================================

export interface BrowserChatRequest {

    requestId: string;

    agentId: string;

    status: RequestStatus;

    message: ChatMessage;

    stream: boolean;

    timeoutMs: number;

    createdAt: number;

    updatedAt: number;

    startedAt?: number;

    completedAt?: number;

    content?: string;

    error?: ErrorData;
}


// ============================================================
// Tool results
// ============================================================

export interface BrowserChatListResult {

    agents: BrowserChatAgent[];
}


export interface BrowserChatAskInput {

    agent: string;

    prompt: string;

    stream?: boolean;

    timeoutMs?: number;
}


export interface BrowserChatAskResult {

    requestId: string;

    agentId: string;

    status: RequestStatus;

    content: string;

    conversationId?: string | null;

    durationMs?: number;
}


export interface BrowserChatCancelInput {

    requestId: string;
}


export interface BrowserChatCancelResult {

    requestId: string;

    canceled: boolean;

    status: RequestStatus;
}


// ============================================================
// Type guards
// ============================================================

export function isRequestEnvelope(
    message: BrowserChatEnvelope
): message is RequestEnvelope {

    return (
        message.type ===
        "request"
    );
}


export function isResponseEnvelope(
    message: BrowserChatEnvelope
): message is ResponseEnvelope {

    return (
        message.type ===
        "response"
    );
}


export function isEventEnvelope(
    message: BrowserChatEnvelope
): message is EventEnvelope {

    return (
        message.type ===
        "event"
    );
}


export function isErrorEnvelope(
    message: BrowserChatEnvelope
): message is ErrorEnvelope {

    return (
        message.type ===
        "error"
    );
}
