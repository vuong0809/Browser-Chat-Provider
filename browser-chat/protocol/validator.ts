// browser-chat/protocol/validator.ts

import {
    AGENT_ID_PATTERN,
    AGENT_STATUS,
    BRIDGE_STATUS,
    CAPABILITY,
    MAX_AGENT_ID_LENGTH,
    MAX_ERROR_MESSAGE_LENGTH,
    MAX_MESSAGE_LENGTH,
    MESSAGE_TYPE,
    METHOD,
    PROTOCOL_VERSION
} from "./constants";

import {
    parseMessage
} from "./messages";

import type {
    BrowserChatEnvelope,
    BrowserChatMethod
} from "./types";


// ============================================================
// Result
// ============================================================

export interface ValidationSuccess {

    valid: true;

    message: BrowserChatEnvelope;
}


export interface ValidationFailure {

    valid: false;

    error: string;

    path?: string;
}


export type ValidationResult =
    | ValidationSuccess
    | ValidationFailure;


// ============================================================
// Public API
// ============================================================

export function validateMessage(
    input: unknown
): ValidationResult {

    const envelopeError =
        validateEnvelope(
            input
        );


    if (envelopeError) {

        return failure(
            envelopeError.error,
            envelopeError.path
        );
    }


    const message =
        input as Record<string, unknown>;


    switch (message.type) {

        case MESSAGE_TYPE.REQUEST:
            return validateRequest(
                message
            );


        case MESSAGE_TYPE.RESPONSE:
            return validateResponse(
                message
            );


        case MESSAGE_TYPE.EVENT:
            return validateEvent(
                message
            );


        case MESSAGE_TYPE.ERROR:
            return validateErrorEnvelope(
                message
            );


        default:

            return failure(
                "Unsupported message type",
                "type"
            );
    }
}


// ============================================================
// Parse + validate
// ============================================================

export function parseAndValidateMessage(
    data: unknown
): ValidationResult {

    let parsed: unknown;


    try {

        parsed =
            parseMessage(
                data
            );

    } catch (error) {

        return failure(
            error instanceof Error
                ? error.message
                : String(error)
        );
    }


    return validateMessage(
        parsed
    );
}


// ============================================================
// Assert
// ============================================================

export function assertValidMessage(
    input: unknown
): BrowserChatEnvelope {

    const result =
        validateMessage(
            input
        );


    if (!result.valid) {

        const path =
            result.path
                ? ` at ${result.path}`
                : "";


        throw new Error(
            `${result.error}${path}`
        );
    }


    return result.message;
}


// ============================================================
// Envelope
// ============================================================

function validateEnvelope(
    input: unknown
): ValidationFailure | null {

    if (!isPlainObject(input)) {

        return failure(
            "Message must be an object"
        );
    }


    if (
        input.v !==
        PROTOCOL_VERSION
    ) {

        return failure(
            `Unsupported protocol version: ${String(input.v)}`,
            "v"
        );
    }


    if (
        !isNonEmptyString(
            input.type
        )
    ) {

        return failure(
            "Message type is required",
            "type"
        );
    }


    if (
        !Object.values(
            MESSAGE_TYPE
        ).includes(
            input.type as never
        )
    ) {

        return failure(
            `Unsupported message type: ${String(input.type)}`,
            "type"
        );
    }


    if (
        !isValidId(
            input.id
        )
    ) {

        return failure(
            "Message id is invalid",
            "id"
        );
    }


    if (
        !isTimestamp(
            input.timestamp
        )
    ) {

        return failure(
            "Message timestamp is invalid",
            "timestamp"
        );
    }


    return null;
}


// ============================================================
// Request
// ============================================================

function validateRequest(
    message: Record<string, unknown>
): ValidationResult {

    const methodResult =
        validateMethod(
            message.method
        );


    if (!methodResult.valid) {
        return methodResult;
    }


    if (
        !isPlainObject(
            message.payload
        )
    ) {

        return failure(
            "Request payload must be an object",
            "payload"
        );
    }


    const payloadResult =
        validateMethodPayload(
            message.method as BrowserChatMethod,
            message.payload,
            "request"
        );


    if (!payloadResult.valid) {
        return payloadResult;
    }


    return success(
        message
    );
}


// ============================================================
// Response
// ============================================================

function validateResponse(
    message: Record<string, unknown>
): ValidationResult {

    if (
        !Object.prototype.hasOwnProperty.call(
            message,
            "result"
        )
    ) {

        return failure(
            "Response result is required",
            "result"
        );
    }


    /*
     * A response does not contain a method in the V1 protocol.
     *
     * The request ID is used by RequestManager to determine
     * which request this response belongs to.
     *
     * Method-specific response validation therefore happens
     * later when RequestManager knows the original request.
     */

    return success(
        message
    );
}


// ============================================================
// Event
// ============================================================

function validateEvent(
    message: Record<string, unknown>
): ValidationResult {

    const methodResult =
        validateMethod(
            message.method
        );


    if (!methodResult.valid) {
        return methodResult;
    }


    if (
        !isPlainObject(
            message.payload
        )
    ) {

        return failure(
            "Event payload must be an object",
            "payload"
        );
    }


    const payloadResult =
        validateMethodPayload(
            message.method as BrowserChatMethod,
            message.payload,
            "event"
        );


    if (!payloadResult.valid) {
        return payloadResult;
    }


    return success(
        message
    );
}


// ============================================================
// Error envelope
// ============================================================

function validateErrorEnvelope(
    message: Record<string, unknown>
): ValidationResult {

    if (
        !isPlainObject(
            message.error
        )
    ) {

        return failure(
            "Error payload must be an object",
            "error"
        );
    }


    const error =
        message.error;


    if (
        !isNonEmptyString(
            error.code
        )
    ) {

        return failure(
            "Error code is required",
            "error.code"
        );
    }


    if (
        !isNonEmptyString(
            error.message
        )
    ) {

        return failure(
            "Error message is required",
            "error.message"
        );
    }


    if (
        error.message.length >
        MAX_ERROR_MESSAGE_LENGTH
    ) {

        return failure(
            "Error message is too long",
            "error.message"
        );
    }


    return success(
        message
    );
}


// ============================================================
// Method
// ============================================================

function validateMethod(
    value: unknown
): ValidationResult {

    if (
        !isNonEmptyString(
            value
        )
    ) {

        return failure(
            "Method is required",
            "method"
        );
    }


    if (
        !Object.values(
            METHOD
        ).includes(
            value as BrowserChatMethod
        )
    ) {

        return failure(
            `Unsupported method: ${value}`,
            "method"
        );
    }


    return {
        valid: true,
        message: {} as BrowserChatEnvelope
    };
}


// ============================================================
// Method payload
// ============================================================

function validateMethodPayload(
    method: BrowserChatMethod,
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    switch (method) {

        // ----------------------------------------------------
        // Bridge
        // ----------------------------------------------------

        case METHOD.BRIDGE_REGISTER:

            return validateBridgeRegister(
                payload,
                direction
            );


        case METHOD.BRIDGE_HEARTBEAT:

            return validateBridgeHeartbeat(
                payload,
                direction
            );


        case METHOD.BRIDGE_STATUS:

            return validateBridgeStatus(
                payload,
                direction
            );


        /*
         * bridge.registered is represented as a response in V1,
         * therefore it should not normally arrive as request/event.
         */

        case METHOD.BRIDGE_REGISTERED:

            return failure(
                "bridge.registered must be sent as a response",
                "method"
            );


        // ----------------------------------------------------
        // Agent
        // ----------------------------------------------------

        case METHOD.AGENT_REGISTER:

            return validateAgentRegister(
                payload
            );


        case METHOD.AGENT_UNREGISTER:

            return validateAgentUnregister(
                payload
            );


        case METHOD.AGENT_STATUS:

            return validateAgentStatus(
                payload
            );


        case METHOD.AGENT_LIST:

            return validateAgentList(
                payload,
                direction
            );


        // ----------------------------------------------------
        // Chat
        // ----------------------------------------------------

        case METHOD.CHAT_SEND:

            return validateChatSend(
                payload,
                direction
            );


        case METHOD.CHAT_DELTA:

            return validateChatDelta(
                payload,
                direction
            );


        case METHOD.CHAT_COMPLETED:

            /*
             * chat.completed is a response in V1.
             */

            return failure(
                "chat.completed must be sent as a response",
                "method"
            );


        case METHOD.CHAT_CANCEL:

            return validateChatCancel(
                payload,
                direction
            );


        case METHOD.CHAT_ERROR:

            return validateChatError(
                payload,
                direction
            );


        default:

            return failure(
                `Unsupported method: ${method}`,
                "method"
            );
    }
}


// ============================================================
// bridge.register
// ============================================================

function validateBridgeRegister(
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    if (
        direction !== "request"
    ) {

        return failure(
            "bridge.register must be a request",
            "type"
        );
    }


    if (
        !isNonEmptyString(
            payload.bridgeId
        )
    ) {

        return failure(
            "bridgeId is required",
            "payload.bridgeId"
        );
    }


    if (
        !isNonEmptyString(
            payload.bridgeVersion
        )
    ) {

        return failure(
            "bridgeVersion is required",
            "payload.bridgeVersion"
        );
    }


    if (
        !Array.isArray(
            payload.capabilities
        )
    ) {

        return failure(
            "capabilities must be an array",
            "payload.capabilities"
        );
    }


    if (
        !payload.capabilities.every(
            isCapability
        )
    ) {

        return failure(
            "Invalid bridge capability",
            "payload.capabilities"
        );
    }


    if (
        payload.token !== undefined &&
        typeof payload.token !== "string"
    ) {

        return failure(
            "token must be a string",
            "payload.token"
        );
    }


    return successPayload();
}


// ============================================================
// bridge.heartbeat
// ============================================================

function validateBridgeHeartbeat(
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    if (
        direction !== "event"
    ) {

        return failure(
            "bridge.heartbeat must be an event",
            "type"
        );
    }


    if (
        !isNonEmptyString(
            payload.bridgeId
        )
    ) {

        return failure(
            "bridgeId is required",
            "payload.bridgeId"
        );
    }


    if (
        payload.status !== undefined &&
        !isBridgeStatus(
            payload.status
        )
    ) {

        return failure(
            "Invalid bridge status",
            "payload.status"
        );
    }


    if (
        payload.agentCount !== undefined &&
        !isNonNegativeInteger(
            payload.agentCount
        )
    ) {

        return failure(
            "agentCount must be a non-negative integer",
            "payload.agentCount"
        );
    }


    return successPayload();
}


// ============================================================
// bridge.status
// ============================================================

function validateBridgeStatus(
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    if (
        direction !== "event"
    ) {

        return failure(
            "bridge.status must be an event",
            "type"
        );
    }


    if (
        !isNonEmptyString(
            payload.bridgeId
        )
    ) {

        return failure(
            "bridgeId is required",
            "payload.bridgeId"
        );
    }


    if (
        !isBridgeStatus(
            payload.status
        )
    ) {

        return failure(
            "Invalid bridge status",
            "payload.status"
        );
    }


    return successPayload();
}


// ============================================================
// agent.register
// ============================================================

function validateAgentRegister(
    payload: Record<string, unknown>
): ValidationResult {

    const bridge =
        validateRequiredString(
            payload.bridgeId,
            "payload.bridgeId"
        );


    if (bridge) {
        return bridge;
    }


    const agent =
        validateAgentId(
            payload.agentId,
            "payload.agentId"
        );


    if (agent) {
        return agent;
    }


    if (
        !isNonEmptyString(
            payload.provider
        )
    ) {

        return failure(
            "provider is required",
            "payload.provider"
        );
    }


    if (
        payload.capabilities !== undefined
    ) {

        if (
            !Array.isArray(
                payload.capabilities
            ) ||
            !payload.capabilities.every(
                isCapability
            )
        ) {

            return failure(
                "Invalid agent capabilities",
                "payload.capabilities"
            );
        }
    }


    if (
        payload.status !== undefined &&
        !isAgentStatus(
            payload.status
        )
    ) {

        return failure(
            "Invalid agent status",
            "payload.status"
        );
    }


    return successPayload();
}


// ============================================================
// agent.unregister
// ============================================================

function validateAgentUnregister(
    payload: Record<string, unknown>
): ValidationResult {

    const bridge =
        validateRequiredString(
            payload.bridgeId,
            "payload.bridgeId"
        );


    if (bridge) {
        return bridge;
    }


    const agent =
        validateAgentId(
            payload.agentId,
            "payload.agentId"
        );


    if (agent) {
        return agent;
    }


    if (
        payload.reason !== undefined &&
        typeof payload.reason !== "string"
    ) {

        return failure(
            "reason must be a string",
            "payload.reason"
        );
    }


    return successPayload();
}


// ============================================================
// agent.status
// ============================================================

function validateAgentStatus(
    payload: Record<string, unknown>
): ValidationResult {

    const agent =
        validateAgentId(
            payload.agentId,
            "payload.agentId"
        );


    if (agent) {
        return agent;
    }


    if (
        !isAgentStatus(
            payload.status
        )
    ) {

        return failure(
            "Invalid agent status",
            "payload.status"
        );
    }


    if (
        payload.requestId !== undefined &&
        payload.requestId !== null &&
        !isValidId(
            payload.requestId
        )
    ) {

        return failure(
            "Invalid requestId",
            "payload.requestId"
        );
    }


    return successPayload();
}


// ============================================================
// agent.list
// ============================================================

function validateAgentList(
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    if (
        direction !== "request"
    ) {

        return failure(
            "agent.list must be a request",
            "type"
        );
    }


    if (
        payload.bridgeId !== undefined &&
        !isNonEmptyString(
            payload.bridgeId
        )
    ) {

        return failure(
            "bridgeId must be a non-empty string",
            "payload.bridgeId"
        );
    }


    return successPayload();
}


// ============================================================
// chat.send
// ============================================================

function validateChatSend(
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    if (
        direction !== "request"
    ) {

        return failure(
            "chat.send must be a request",
            "type"
        );
    }


    const agent =
        validateAgentId(
            payload.agentId,
            "payload.agentId"
        );


    if (agent) {
        return agent;
    }


    if (
        !isPlainObject(
            payload.message
        )
    ) {

        return failure(
            "message must be an object",
            "payload.message"
        );
    }


    if (
        payload.message.role !==
        "user"
    ) {

        return failure(
            "Browser chat.send role must be user",
            "payload.message.role"
        );
    }


    if (
        !isNonEmptyString(
            payload.message.content
        )
    ) {

        return failure(
            "message content is required",
            "payload.message.content"
        );
    }


    if (
        payload.message.content.length >
        MAX_MESSAGE_LENGTH
    ) {

        return failure(
            "message content is too long",
            "payload.message.content"
        );
    }


    if (
        payload.options !== undefined
    ) {

        if (
            !isPlainObject(
                payload.options
            )
        ) {

            return failure(
                "options must be an object",
                "payload.options"
            );
        }


        if (
            payload.options.stream !== undefined &&
            typeof payload.options.stream !== "boolean"
        ) {

            return failure(
                "stream must be boolean",
                "payload.options.stream"
            );
        }


        if (
            payload.options.timeout !== undefined &&
            !isPositiveNumber(
                payload.options.timeout
            )
        ) {

            return failure(
                "timeout must be a positive number",
                "payload.options.timeout"
            );
        }
    }


    return successPayload();
}


// ============================================================
// chat.delta
// ============================================================

function validateChatDelta(
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    if (
        direction !== "event"
    ) {

        return failure(
            "chat.delta must be an event",
            "type"
        );
    }


    if (
        !isValidId(
            payload.requestId
        )
    ) {

        return failure(
            "Invalid requestId",
            "payload.requestId"
        );
    }


    const agent =
        validateAgentId(
            payload.agentId,
            "payload.agentId"
        );


    if (agent) {
        return agent;
    }


    if (
        !isNonNegativeInteger(
            payload.seq
        )
    ) {

        return failure(
            "seq must be a non-negative integer",
            "payload.seq"
        );
    }


    if (
        typeof payload.delta !== "string"
    ) {

        return failure(
            "delta must be a string",
            "payload.delta"
        );
    }


    if (
        payload.fullText !== undefined &&
        typeof payload.fullText !== "string"
    ) {

        return failure(
            "fullText must be a string",
            "payload.fullText"
        );
    }


    if (
        payload.replace !== undefined &&
        typeof payload.replace !== "boolean"
    ) {

        return failure(
            "replace must be boolean",
            "payload.replace"
        );
    }


    return successPayload();
}


// ============================================================
// chat.cancel
// ============================================================

function validateChatCancel(
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    if (
        direction !== "request"
    ) {

        return failure(
            "chat.cancel must be a request",
            "type"
        );
    }


    if (
        !isValidId(
            payload.requestId
        )
    ) {

        return failure(
            "Invalid requestId",
            "payload.requestId"
        );
    }


    if (
        payload.agentId !== undefined
    ) {

        const agent =
            validateAgentId(
                payload.agentId,
                "payload.agentId"
            );


        if (agent) {
            return agent;
        }
    }


    return successPayload();
}


// ============================================================
// chat.error
// ============================================================

function validateChatError(
    payload: Record<string, unknown>,
    direction: "request" | "event"
): ValidationResult {

    if (
        direction !== "event"
    ) {

        return failure(
            "chat.error must be an event",
            "type"
        );
    }


    if (
        !isValidId(
            payload.requestId
        )
    ) {

        return failure(
            "Invalid requestId",
            "payload.requestId"
        );
    }


    const agent =
        validateAgentId(
            payload.agentId,
            "payload.agentId"
        );


    if (agent) {
        return agent;
    }


    if (
        !isNonEmptyString(
            payload.message
        )
    ) {

        return failure(
            "message is required",
            "payload.message"
        );
    }


    if (
        payload.message.length >
        MAX_ERROR_MESSAGE_LENGTH
    ) {

        return failure(
            "Error message is too long",
            "payload.message"
        );
    }


    return successPayload();
}


// ============================================================
// Helpers
// ============================================================

function isPlainObject(
    value: unknown
): value is Record<string, unknown> {

    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}


function isNonEmptyString(
    value: unknown
): value is string {

    return (
        typeof value === "string" &&
        value.trim().length > 0
    );
}


function isTimestamp(
    value: unknown
): value is number {

    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0
    );
}


function isValidId(
    value: unknown
): value is string {

    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 256
    );
}


function isNonNegativeInteger(
    value: unknown
): value is number {

    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0
    );
}


function isPositiveNumber(
    value: unknown
): value is number {

    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0
    );
}


function isCapability(
    value: unknown
): boolean {

    return (
        typeof value === "string" &&
        value.length > 0
    );
}


function isBridgeStatus(
    value: unknown
): boolean {

    return Object.values(
        BRIDGE_STATUS
    ).includes(
        value as never
    );
}


function isAgentStatus(
    value: unknown
): boolean {

    return Object.values(
        AGENT_STATUS
    ).includes(
        value as never
    );
}


function validateAgentId(
    value: unknown,
    path: string
): ValidationFailure | null {

    if (
        !isNonEmptyString(
            value
        )
    ) {

        return failure(
            "agentId is required",
            path
        );
    }


    if (
        value.length >
        MAX_AGENT_ID_LENGTH
    ) {

        return failure(
            `agentId must not exceed ${MAX_AGENT_ID_LENGTH} characters`,
            path
        );
    }


    if (
        !AGENT_ID_PATTERN.test(
            value
        )
    ) {

        return failure(
            "agentId may contain only letters, numbers, hyphen and underscore",
            path
        );
    }


    return null;
}


function validateRequiredString(
    value: unknown,
    path: string
): ValidationFailure | null {

    if (
        !isNonEmptyString(
            value
        )
    ) {

        return failure(
            "Value is required",
            path
        );
    }


    return null;
}


// ============================================================
// Result helpers
// ============================================================

function success(
    message: Record<string, unknown>
): ValidationSuccess {

    return {
        valid: true,

        message:
            message as unknown as
            BrowserChatEnvelope
    };
}


/*
 * Used internally while validating only a payload.
 *
 * The temporary message is never exposed when validation of the
 * outer envelope completes successfully.
 */

function successPayload(): ValidationSuccess {

    return {
        valid: true,
        message:
            {} as BrowserChatEnvelope
    };
}


function failure(
    error: string,
    path?: string
): ValidationFailure {

    return {
        valid: false,

        error,

        ...(path
            ? {
                path
            }
            : {})
    };
}