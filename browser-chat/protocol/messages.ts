// browser-chat/protocol/messages.ts

import {
    MESSAGE_TYPE,
    METHOD,
    PROTOCOL_VERSION
} from "./constants";

import type {
    AgentStatus,
    AgentStatusPayload,
    BrowserChatEnvelope,
    BrowserChatMethod,
    ChatCancelPayload,
    ChatCompletedResult,
    ChatDeltaPayload,
    ChatErrorPayload,
    ChatMessage,
    ChatSendOptions,
    ChatSendPayload,
    ErrorData,
    ErrorEnvelope,
    EventEnvelope,
    RequestEnvelope,
    ResponseEnvelope
} from "./types";


// ============================================================
// Time
// ============================================================

export function now(): number {

    return Date.now();
}


// ============================================================
// ID generation
// ============================================================

export function generateId(
    prefix = "msg"
): string {

    const timestamp =
        Date.now()
            .toString(36);


    let randomPart: string;


    if (
        typeof globalThis.crypto !== "undefined" &&
        typeof globalThis.crypto.randomUUID === "function"
    ) {

        randomPart =
            globalThis.crypto
                .randomUUID()
                .replace(/-/g, "")
                .slice(0, 12);

    } else {

        randomPart =
            Math.random()
                .toString(36)
                .slice(2, 14);
    }


    return (
        `${prefix}_${timestamp}_${randomPart}`
    );
}


// ============================================================
// Generic request
// ============================================================

export function createRequest<
    TMethod extends BrowserChatMethod,
    TPayload
>(
    method: TMethod,
    payload: TPayload,
    id = generateId("req")
): RequestEnvelope<
    TMethod,
    TPayload
> {

    return {
        v:
            PROTOCOL_VERSION,

        type:
            MESSAGE_TYPE.REQUEST,

        id,

        timestamp:
            now(),

        method,

        payload
    };
}


// ============================================================
// Generic response
// ============================================================

export function createResponse<
    TResult
>(
    requestId: string,
    result: TResult
): ResponseEnvelope<TResult> {

    return {
        v:
            PROTOCOL_VERSION,

        type:
            MESSAGE_TYPE.RESPONSE,

        id:
            requestId,

        timestamp:
            now(),

        result
    };
}


// ============================================================
// Generic event
// ============================================================

export function createEvent<
    TMethod extends BrowserChatMethod,
    TPayload
>(
    method: TMethod,
    payload: TPayload,
    id = generateId("evt")
): EventEnvelope<
    TMethod,
    TPayload
> {

    return {
        v:
            PROTOCOL_VERSION,

        type:
            MESSAGE_TYPE.EVENT,

        id,

        timestamp:
            now(),

        method,

        payload
    };
}


// ============================================================
// Generic error
// ============================================================

export function createError(
    requestId: string | null | undefined,
    code: string,
    message: string,
    details?: unknown
): ErrorEnvelope {

    const error: ErrorData = {
        code,
        message
    };


    if (
        details !== undefined
    ) {

        error.details =
            details;
    }


    return {
        v:
            PROTOCOL_VERSION,

        type:
            MESSAGE_TYPE.ERROR,

        id:
            requestId ||
            generateId("err"),

        timestamp:
            now(),

        error
    };
}


// ============================================================
// Bridge registered
// ============================================================

export function createBridgeRegistered(
    requestId: string,
    bridgeId: string,
    options: {
        accepted?: boolean;
        heartbeatIntervalMs?: number;
        serverVersion?: string;
        message?: string;
    } = {}
): ResponseEnvelope {

    const {
        accepted = true,
        heartbeatIntervalMs,
        serverVersion,
        message
    } = options;


    return createResponse(
        requestId,
        {
            bridgeId,

            accepted,

            ...(heartbeatIntervalMs !== undefined
                ? {
                    heartbeatIntervalMs
                }
                : {}),

            ...(serverVersion !== undefined
                ? {
                    serverVersion
                }
                : {}),

            ...(message !== undefined
                ? {
                    message
                }
                : {})
        }
    );
}


// ============================================================
// Bridge status
// ============================================================

export function createBridgeStatus(
    bridgeId: string,
    status: string,
    extra: Record<string, unknown> = {}
): EventEnvelope {

    return createEvent(
        METHOD.BRIDGE_STATUS,
        {
            bridgeId,
            status,
            ...extra
        }
    );
}


// ============================================================
// Agent status
// ============================================================

export function createAgentStatus(
    agentId: string,
    status: AgentStatus,
    options: {
        bridgeId?: string;
        requestId?: string | null;
        conversationId?: string | null;
        title?: string | null;
        error?: string;
    } = {}
): EventEnvelope<
    typeof METHOD.AGENT_STATUS,
    AgentStatusPayload
> {

    const payload: AgentStatusPayload = {

        agentId,

        status
    };


    if (
        options.bridgeId !== undefined
    ) {
        payload.bridgeId =
            options.bridgeId;
    }


    if (
        options.requestId !== undefined
    ) {
        payload.requestId =
            options.requestId;
    }


    if (
        options.conversationId !== undefined
    ) {
        payload.conversationId =
            options.conversationId;
    }


    if (
        options.title !== undefined
    ) {
        payload.title =
            options.title;
    }


    if (
        options.error !== undefined
    ) {
        payload.error =
            options.error;
    }


    return createEvent(
        METHOD.AGENT_STATUS,
        payload
    );
}


// ============================================================
// Agent list request
// ============================================================

export function createAgentListRequest(
    bridgeId?: string
): RequestEnvelope {

    return createRequest(
        METHOD.AGENT_LIST,
        bridgeId
            ? {
                bridgeId
            }
            : {}
    );
}


// ============================================================
// Chat send
// ============================================================

export function createChatSend(
    agentId: string,
    content: string,
    options: ChatSendOptions = {},
    requestId = generateId("req")
): RequestEnvelope<
    typeof METHOD.CHAT_SEND,
    ChatSendPayload
> {

    const message: ChatMessage = {

        role:
            "user",

        content
    };


    const payload: ChatSendPayload = {

        agentId,

        message,

        options: {
            stream:
                options.stream ??
                true,

            ...(options.timeout !== undefined
                ? {
                    timeout:
                        options.timeout
                }
                : {})
        }
    };


    return createRequest(
        METHOD.CHAT_SEND,
        payload,
        requestId
    );
}


// ============================================================
// Chat cancel
// ============================================================

export function createChatCancel(
    requestId: string,
    agentId?: string
): RequestEnvelope<
    typeof METHOD.CHAT_CANCEL,
    ChatCancelPayload
> {

    const payload: ChatCancelPayload = {

        requestId
    };


    if (
        agentId !== undefined
    ) {

        payload.agentId =
            agentId;
    }


    /*
     * Important:
     *
     * The cancel command is a new protocol request, therefore it
     * receives its own envelope ID.
     *
     * The request being canceled remains in payload.requestId.
     */

    return createRequest(
        METHOD.CHAT_CANCEL,
        payload,
        generateId("req")
    );
}


// ============================================================
// Chat delta
// ============================================================

export function createChatDelta(
    requestId: string,
    agentId: string,
    seq: number,
    delta: string,
    options: {
        fullText?: string;
        replace?: boolean;
    } = {}
): EventEnvelope<
    typeof METHOD.CHAT_DELTA,
    ChatDeltaPayload
> {

    const payload: ChatDeltaPayload = {

        requestId,

        agentId,

        seq,

        delta
    };


    if (
        options.fullText !== undefined
    ) {

        payload.fullText =
            options.fullText;
    }


    if (
        options.replace !== undefined
    ) {

        payload.replace =
            options.replace;
    }


    return createEvent(
        METHOD.CHAT_DELTA,
        payload
    );
}


// ============================================================
// Chat completed
// ============================================================

export function createChatCompleted(
    requestId: string,
    agentId: string,
    content: string,
    options: {
        conversationId?: string | null;
        title?: string | null;
        durationMs?: number;
    } = {}
): ResponseEnvelope<
    ChatCompletedResult
> {

    const result: ChatCompletedResult = {

        agentId,

        status:
            "completed",

        content
    };


    if (
        options.conversationId !== undefined
    ) {

        result.conversationId =
            options.conversationId;
    }


    if (
        options.title !== undefined
    ) {

        result.title =
            options.title;
    }


    if (
        options.durationMs !== undefined
    ) {

        result.durationMs =
            options.durationMs;
    }


    /*
     * Completion MUST use the original chat.send request ID.
     */

    return createResponse(
        requestId,
        result
    );
}


// ============================================================
// Chat error event
// ============================================================

export function createChatError(
    requestId: string,
    agentId: string,
    message: string,
    options: {
        code?: string;
        details?: unknown;
    } = {}
): EventEnvelope<
    typeof METHOD.CHAT_ERROR,
    ChatErrorPayload
> {

    const payload: ChatErrorPayload = {

        requestId,

        agentId,

        message
    };


    if (
        options.code !== undefined
    ) {

        payload.code =
            options.code;
    }


    if (
        options.details !== undefined
    ) {

        payload.details =
            options.details;
    }


    return createEvent(
        METHOD.CHAT_ERROR,
        payload
    );
}


// ============================================================
// Serialization
// ============================================================

export function serializeMessage(
    message: BrowserChatEnvelope
): string {

    return JSON.stringify(
        message
    );
}


// ============================================================
// Parsing
// ============================================================

export function parseMessage(
    data: unknown
): unknown {

    if (
        typeof data === "string"
    ) {

        return JSON.parse(
            data
        );
    }


    /*
     * Node ws commonly delivers Buffer.
     */

    if (
        typeof Buffer !== "undefined" &&
        Buffer.isBuffer(data)
    ) {

        return JSON.parse(
            data.toString("utf8")
        );
    }


    /*
     * ArrayBuffer support keeps this helper usable outside
     * the Node ws implementation as well.
     */

    if (
        data instanceof ArrayBuffer
    ) {

        const text =
            new TextDecoder()
                .decode(data);


        return JSON.parse(
            text
        );
    }


    /*
     * Uint8Array / Buffer-like typed arrays.
     */

    if (
        ArrayBuffer.isView(data)
    ) {

        const view =
            new Uint8Array(
                data.buffer,
                data.byteOffset,
                data.byteLength
            );


        const text =
            new TextDecoder()
                .decode(view);


        return JSON.parse(
            text
        );
    }


    /*
     * Already parsed object.
     *
     * Validation is deliberately handled by validator.ts.
     */

    if (
        data !== null &&
        typeof data === "object"
    ) {

        return data;
    }


    throw new Error(
        "Unsupported Browser Chat message format"
    );
}