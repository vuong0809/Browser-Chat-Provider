// browser-chat/request-manager.ts

import {
    AGENT_STATUS,
    ERROR_CODE,
    MESSAGE_TYPE,
    METHOD,
    REQUEST_STATUS
} from "./protocol/constants";

import {
    createChatCancel,
    createChatSend
} from "./protocol/messages";

import type {
    BrowserChatAskResult,
    BrowserChatEnvelope,
    BrowserChatRequest,
    ChatCompletedResult,
    ChatDeltaPayload,
    ChatErrorPayload,
    ErrorEnvelope,
    EventEnvelope,
    ResponseEnvelope
} from "./protocol/types";

import {
    AgentRegistry,
    AgentRegistryError
} from "./agent-registry";

import {
    BridgeManager,
    BridgeManagerError
} from "./bridge-manager";

import {
    createLogger
} from "./shared/logger";

import {
    createDeferred,
    elapsedMs,
    generateId,
    getErrorMessage,
    normalizeRequestTimeout,
    now
} from "./shared/utils";

import type {
    Deferred
} from "./shared/utils";


const logger =
    createLogger(
        "RequestManager"
    );


// ============================================================
// Runtime request
// ============================================================

interface RuntimeRequest {

    record:
    BrowserChatRequest;

    deferred:
    Deferred<
        BrowserChatAskResult
    >;

    timer:
    ReturnType<
        typeof setTimeout
    > | null;

    /*
     * Accumulated streamed content.
     *
     * Completion response remains authoritative, but keeping
     * this allows progress callbacks and future streaming tools.
     */

    streamedContent:
    string;

    lastSeq:
    number;

    bridgeId:
    string | null;
}


// ============================================================
// Ask options
// ============================================================

export interface AskOptions {

    stream?: boolean;

    timeoutMs?: number;

    onDelta?: (
        delta: string,
        info: {
            requestId: string;
            agentId: string;
            seq: number;
            fullText: string;
            replace: boolean;
        }
    ) =>
        void |
        Promise<void>;
}


// ============================================================
// Options
// ============================================================

export interface RequestManagerOptions {

    agentRegistry:
    AgentRegistry;

    bridgeManager:
    BridgeManager;

    onStatusChange?: (
        request:
            BrowserChatRequest
    ) =>
        void |
        Promise<void>;
}


// ============================================================
// Errors
// ============================================================

export class BrowserChatRequestError
    extends Error {

    readonly code:
        string;

    readonly requestId?:
        string;

    readonly agentId?:
        string;


    constructor(
        code: string,
        message: string,
        options: {
            requestId?: string;
            agentId?: string;
        } = {}
    ) {

        super(
            message
        );


        this.name =
            "BrowserChatRequestError";


        this.code =
            code;

        this.requestId =
            options.requestId;

        this.agentId =
            options.agentId;
    }
}


// ============================================================
// Request manager
// ============================================================

export class RequestManager {

    private readonly agentRegistry:
        AgentRegistry;


    private readonly bridgeManager:
        BridgeManager;


    private readonly onStatusChange?:
        RequestManagerOptions[
        "onStatusChange"
        ];


    private readonly requests =
        new Map<
            string,
            RuntimeRequest
        >();


    constructor(
        options:
            RequestManagerOptions
    ) {

        this.agentRegistry =
            options.agentRegistry;

        this.bridgeManager =
            options.bridgeManager;

        this.onStatusChange =
            options.onStatusChange;
    }


    // ========================================================
    // Ask
    // ========================================================

    async ask(
        agentId: string,
        prompt: string,
        options:
            AskOptions = {}
    ): Promise<
        BrowserChatAskResult
    > {

        const normalizedAgentId =
            agentId.trim();


        const normalizedPrompt =
            prompt.trim();


        if (!normalizedPrompt) {

            throw new BrowserChatRequestError(
                ERROR_CODE.INVALID_PAYLOAD,
                "Prompt must not be empty",
                {
                    agentId:
                        normalizedAgentId
                }
            );
        }


        const agent =
            this.agentRegistry.require(
                normalizedAgentId
            );


        if (
            agent.status ===
            AGENT_STATUS.OFFLINE
        ) {

            throw new BrowserChatRequestError(
                ERROR_CODE.AGENT_OFFLINE,
                `Agent "${normalizedAgentId}" is offline`,
                {
                    agentId:
                        normalizedAgentId
                }
            );
        }


        if (
            !agent.bridgeId ||
            !this.bridgeManager.isBridgeReady(
                agent.bridgeId
            )
        ) {

            throw new BrowserChatRequestError(
                ERROR_CODE.BRIDGE_OFFLINE,
                `Bridge for agent "${normalizedAgentId}" is offline`,
                {
                    agentId:
                        normalizedAgentId
                }
            );
        }


        const requestId =
            generateId(
                "req"
            );


        const timeoutMs =
            normalizeRequestTimeout(
                options.timeoutMs
            );


        const stream =
            options.stream ??
            true;


        /*
         * Recover a stale agent lock before acquiring it.
         *
         * AgentRegistry owns the lock state while RequestManager owns
         * the actual runtime requests. If activeRequestId points to a
         * request that no longer exists here, the lock is stale.
         *
         * This can happen after:
         * - bridge reconnect
         * - Electron restart
         * - abnormal request termination
         * - a previous lifecycle race
         *
         * Never clear the lock when the referenced request is still
         * active in this.requests.
         */
        logger.info(
            "Agent lock state before acquire",
            {
                agentId: normalizedAgentId,
                agentStatus: agent.status,
                activeRequestId: agent.activeRequestId,
                activeRequestExists:
                    agent.activeRequestId
                        ? this.requests.has(
                            agent.activeRequestId
                        )
                        : false,
                runtimeRequestCount:
                    this.requests.size
            }
        );
        if (agent.activeRequestId) {

            const activeRuntime =
                this.requests.get(
                    agent.activeRequestId
                );


            if (!activeRuntime) {

                logger.warn(
                    "Recovering stale agent lock",
                    {
                        agentId:
                            normalizedAgentId,

                        staleRequestId:
                            agent.activeRequestId,

                        agentStatus:
                            agent.status
                    }
                );


                try {

                    this.agentRegistry.release(
                        normalizedAgentId,
                        agent.activeRequestId,
                        AGENT_STATUS.IDLE
                    );

                } catch (error) {

                    logger.warn(
                        "Unable to recover stale agent lock",
                        {
                            agentId:
                                normalizedAgentId,

                            staleRequestId:
                                agent.activeRequestId,

                            error:
                                getErrorMessage(
                                    error
                                )
                        }
                    );


                    throw normalizeManagerError(
                        error,
                        requestId,
                        normalizedAgentId
                    );
                }

            } else if (
                !isTerminalStatus(
                    activeRuntime.record.status
                )
            ) {

                /*
                 * This is a real active request.
                 * Keep the one-request-per-agent guarantee.
                 */

                throw new BrowserChatRequestError(
                    ERROR_CODE.AGENT_BUSY,
                    `Agent "${normalizedAgentId}" is busy`,
                    {
                        requestId,
                        agentId:
                            normalizedAgentId
                    }
                );

            } else {

                /*
                 * Defensive recovery.
                 *
                 * Normally terminal requests are removed from
                 * this.requests immediately. If one is still present,
                 * its agent lock must not block future requests.
                 */

                logger.warn(
                    "Recovering terminal agent lock",
                    {
                        agentId:
                            normalizedAgentId,

                        staleRequestId:
                            agent.activeRequestId,

                        requestStatus:
                            activeRuntime.record.status
                    }
                );


                try {

                    this.agentRegistry.release(
                        normalizedAgentId,
                        agent.activeRequestId,
                        AGENT_STATUS.IDLE
                    );

                } catch (error) {

                    throw normalizeManagerError(
                        error,
                        requestId,
                        normalizedAgentId
                    );
                }
            }
        }


        /*
         * Lock agent before storing/sending request.
         */

        try {

            this.agentRegistry.acquire(
                normalizedAgentId,
                requestId
            );

        } catch (error) {

            throw normalizeManagerError(
                error,
                requestId,
                normalizedAgentId
            );
        }


        const timestamp =
            now();


        const record:
            BrowserChatRequest = {

            requestId,

            agentId:
                normalizedAgentId,

            status:
                REQUEST_STATUS.PENDING,

            message: {
                role:
                    "user",

                content:
                    normalizedPrompt
            },

            stream,

            timeoutMs,

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        };


        const runtime:
            RuntimeRequest = {

            record,

            deferred:
                createDeferred<
                    BrowserChatAskResult
                >(),

            timer:
                null,

            streamedContent:
                "",

            lastSeq:
                -1,

            bridgeId:
                agent.bridgeId ??
                null
        };


        this.requests.set(
            requestId,
            runtime
        );


        this.startTimeout(
            runtime
        );


        try {

            await this.setRequestStatus(
                runtime,
                REQUEST_STATUS.SENDING
            );


            const message =
                createChatSend(
                    normalizedAgentId,
                    normalizedPrompt,
                    {
                        stream,

                        timeout:
                            timeoutMs
                    },
                    requestId
                );


            await this.bridgeManager
                .sendToAgent(
                    normalizedAgentId,
                    message
                );


            logger.info(
                "Browser chat request sent",
                {
                    requestId,

                    agentId:
                        normalizedAgentId,

                    bridgeId:
                        runtime.bridgeId,

                    timeoutMs,

                    stream
                }
            );

        } catch (error) {

            await this.failRequest(
                runtime,
                normalizeManagerError(
                    error,
                    requestId,
                    normalizedAgentId
                )
            );
        }


        return runtime
            .deferred
            .promise;
    }


    // ========================================================
    // Handle inbound message
    // ========================================================

    async handleMessage(
        message:
            BrowserChatEnvelope
    ): Promise<boolean> {

        if (
            message.type ===
            MESSAGE_TYPE.EVENT
        ) {

            const event =
                message as EventEnvelope;


            switch (
            event.method
            ) {

                case METHOD.CHAT_DELTA:

                    await this.handleDelta(
                        event.payload as
                        ChatDeltaPayload
                    );

                    return true;


                case METHOD.CHAT_ERROR:

                    await this.handleChatError(
                        event.payload as
                        ChatErrorPayload
                    );

                    return true;


                case METHOD.AGENT_STATUS:

                    /*
                     * BridgeManager normally consumes
                     * agent.status before RequestManager.
                     *
                     * This branch is retained for callers that
                     * route the event here directly.
                     */

                    return false;
            }
        }


        if (
            message.type ===
            MESSAGE_TYPE.RESPONSE
        ) {

            return await this.handleResponse(
                message as ResponseEnvelope
            );
        }


        if (
            message.type ===
            MESSAGE_TYPE.ERROR
        ) {

            return await this.handleErrorEnvelope(
                message as ErrorEnvelope
            );
        }


        return false;
    }


    // ========================================================
    // Delta
    // ========================================================

    async handleDelta(
        payload:
            ChatDeltaPayload
    ): Promise<void> {

        const runtime =
            this.requests.get(
                payload.requestId
            );


        if (!runtime) {

            logger.debug(
                "Ignoring delta for unknown request",
                {
                    requestId:
                        payload.requestId,

                    agentId:
                        payload.agentId
                }
            );


            return;
        }


        if (
            runtime.record.agentId !==
            payload.agentId
        ) {

            logger.warn(
                "Ignoring delta with agent mismatch",
                {
                    requestId:
                        payload.requestId,

                    expectedAgentId:
                        runtime.record.agentId,

                    receivedAgentId:
                        payload.agentId
                }
            );


            return;
        }


        if (
            isTerminalStatus(
                runtime.record.status
            )
        ) {
            return;
        }


        /*
         * Ignore duplicate/out-of-order delta sequence numbers.
         */

        if (
            payload.seq <=
            runtime.lastSeq
        ) {

            logger.debug(
                "Ignoring old chat delta",
                {
                    requestId:
                        payload.requestId,

                    seq:
                        payload.seq,

                    lastSeq:
                        runtime.lastSeq
                }
            );


            return;
        }


        runtime.lastSeq =
            payload.seq;


        const replace =
            payload.replace ===
            true;


        if (
            typeof payload.fullText ===
            "string"
        ) {

            runtime.streamedContent =
                payload.fullText;

        } else if (replace) {

            runtime.streamedContent =
                payload.delta;

        } else {

            runtime.streamedContent +=
                payload.delta;
        }


        if (
            runtime.record.status !==
            REQUEST_STATUS.GENERATING
        ) {

            await this.setRequestStatus(
                runtime,
                REQUEST_STATUS.GENERATING
            );


            try {

                this.agentRegistry.setStatus(
                    runtime.record.agentId,
                    AGENT_STATUS.GENERATING,
                    {
                        requestId:
                            runtime.record
                                .requestId
                    }
                );

            } catch {
                // Registry may have gone offline concurrently.
            }
        }


        runtime.record.content =
            runtime.streamedContent;

        runtime.record.updatedAt =
            now();


        const callback =
            (
                runtime as RuntimeRequest & {
                    onDelta?:
                    AskOptions["onDelta"];
                }
            ).onDelta;


        if (callback) {

            try {

                await callback(
                    payload.delta,
                    {
                        requestId:
                            runtime.record
                                .requestId,

                        agentId:
                            runtime.record
                                .agentId,

                        seq:
                            payload.seq,

                        fullText:
                            runtime.streamedContent,

                        replace
                    }
                );

            } catch (error) {

                logger.error(
                    "Delta callback failed",
                    error,
                    {
                        requestId:
                            runtime.record
                                .requestId,

                        agentId:
                            runtime.record
                                .agentId
                    }
                );
            }
        }
    }


    // ========================================================
    // Response
    // ========================================================

    private async handleResponse(
        message:
            ResponseEnvelope
    ): Promise<boolean> {

        const runtime =
            this.requests.get(
                message.id
            );


        if (!runtime) {

            return false;
        }


        if (
            isTerminalStatus(
                runtime.record.status
            )
        ) {

            return true;
        }


        if (
            !isChatCompletedResult(
                message.result
            )
        ) {

            await this.failRequest(
                runtime,
                new BrowserChatRequestError(
                    ERROR_CODE.INVALID_PAYLOAD,
                    "Invalid chat completion response",
                    {
                        requestId:
                            runtime.record
                                .requestId,

                        agentId:
                            runtime.record
                                .agentId
                    }
                )
            );


            return true;
        }


        const result =
            message.result;


        if (
            result.agentId !==
            runtime.record.agentId
        ) {

            await this.failRequest(
                runtime,
                new BrowserChatRequestError(
                    ERROR_CODE.REQUEST_MISMATCH,
                    "Chat completion agent does not match request",
                    {
                        requestId:
                            runtime.record
                                .requestId,

                        agentId:
                            runtime.record
                                .agentId
                    }
                )
            );


            return true;
        }


        await this.completeRequest(
            runtime,
            result
        );


        return true;
    }


    // ========================================================
    // Chat error event
    // ========================================================

    private async handleChatError(
        payload:
            ChatErrorPayload
    ): Promise<void> {

        const runtime =
            this.requests.get(
                payload.requestId
            );


        if (!runtime) {
            return;
        }


        if (
            runtime.record.agentId !==
            payload.agentId
        ) {

            logger.warn(
                "Ignoring chat error with agent mismatch",
                {
                    requestId:
                        payload.requestId,

                    expectedAgentId:
                        runtime.record.agentId,

                    receivedAgentId:
                        payload.agentId
                }
            );


            return;
        }


        await this.failRequest(
            runtime,
            new BrowserChatRequestError(
                payload.code ??
                ERROR_CODE.INTERNAL_ERROR,

                payload.message,

                {
                    requestId:
                        payload.requestId,

                    agentId:
                        payload.agentId
                }
            )
        );
    }


    // ========================================================
    // Protocol error envelope
    // ========================================================

    private async handleErrorEnvelope(
        message:
            ErrorEnvelope
    ): Promise<boolean> {

        const runtime =
            this.requests.get(
                message.id
            );


        if (!runtime) {
            return false;
        }


        await this.failRequest(
            runtime,
            new BrowserChatRequestError(
                message.error.code,
                message.error.message,
                {
                    requestId:
                        runtime.record
                            .requestId,

                    agentId:
                        runtime.record
                            .agentId
                }
            )
        );


        return true;
    }


    // ========================================================
    // Complete
    // ========================================================

    private async completeRequest(
        runtime:
            RuntimeRequest,
        result:
            ChatCompletedResult
    ): Promise<void> {

        if (
            isTerminalStatus(
                runtime.record.status
            )
        ) {
            return;
        }


        this.clearTimer(
            runtime
        );


        const completedAt =
            now();


        runtime.record.status =
            REQUEST_STATUS.COMPLETED;

        runtime.record.content =
            result.content;

        runtime.record.completedAt =
            completedAt;

        runtime.record.updatedAt =
            completedAt;


        try {

            this.agentRegistry.setStatus(
                runtime.record.agentId,
                AGENT_STATUS.COMPLETED,
                {
                    requestId:
                        runtime.record
                            .requestId,

                    conversationId:
                        result.conversationId,

                    title:
                        result.title
                }
            );


            this.agentRegistry.release(
                runtime.record.agentId,
                runtime.record.requestId,
                AGENT_STATUS.IDLE
            );

        } catch (error) {

            logger.warn(
                "Unable to release completed agent",
                {
                    requestId:
                        runtime.record
                            .requestId,

                    agentId:
                        runtime.record
                            .agentId,

                    error:
                        getErrorMessage(
                            error
                        )
                }
            );
        }


        const durationMs =
            result.durationMs ??
            elapsedMs(
                runtime.record.createdAt,
                completedAt
            );


        const toolResult:
            BrowserChatAskResult = {

            requestId:
                runtime.record.requestId,

            agentId:
                runtime.record.agentId,

            status:
                REQUEST_STATUS.COMPLETED,

            content:
                result.content,

            conversationId:
                result.conversationId,

            durationMs
        };


        runtime.deferred.resolve(
            toolResult
        );


        await this.emitStatus(
            runtime.record
        );


        logger.info(
            "Browser chat request completed",
            {
                requestId:
                    runtime.record
                        .requestId,

                agentId:
                    runtime.record
                        .agentId,

                durationMs
            }
        );


        this.requests.delete(
            runtime.record.requestId
        );
    }


    // ========================================================
    // Fail
    // ========================================================

    private async failRequest(
        runtime:
            RuntimeRequest,
        error:
            BrowserChatRequestError
    ): Promise<void> {

        if (
            isTerminalStatus(
                runtime.record.status
            )
        ) {
            return;
        }


        this.clearTimer(
            runtime
        );


        const failedAt =
            now();


        runtime.record.status =
            REQUEST_STATUS.ERROR;

        runtime.record.updatedAt =
            failedAt;

        runtime.record.completedAt =
            failedAt;

        runtime.record.error = {
            code:
                error.code,

            message:
                error.message
        };


        this.releaseAgentSafely(
            runtime,
            AGENT_STATUS.ERROR
        );


        runtime.deferred.reject(
            error
        );


        await this.emitStatus(
            runtime.record
        );


        logger.error(
            "Browser chat request failed",
            error,
            {
                requestId:
                    runtime.record
                        .requestId,

                agentId:
                    runtime.record
                        .agentId
            }
        );


        this.requests.delete(
            runtime.record.requestId
        );
    }


    // ========================================================
    // Cancel
    // ========================================================

    async cancel(
        requestId: string
    ): Promise<boolean> {

        const runtime =
            this.requests.get(
                requestId
            );


        if (!runtime) {

            throw new BrowserChatRequestError(
                ERROR_CODE.REQUEST_NOT_FOUND,
                `Request "${requestId}" was not found`,
                {
                    requestId
                }
            );
        }


        if (
            isTerminalStatus(
                runtime.record.status
            )
        ) {

            return false;
        }


        /*
         * Send cancellation before locally finalizing the
         * request, while the agent/bridge mapping is intact.
         */

        try {

            await this.bridgeManager
                .sendToAgent(
                    runtime.record.agentId,
                    createChatCancel(
                        runtime.record.requestId,
                        runtime.record.agentId
                    )
                );

        } catch (error) {

            logger.warn(
                "Unable to send cancel to browser bridge",
                {
                    requestId,

                    agentId:
                        runtime.record
                            .agentId,

                    error:
                        getErrorMessage(
                            error
                        )
                }
            );
        }


        this.clearTimer(
            runtime
        );


        const timestamp =
            now();


        runtime.record.status =
            REQUEST_STATUS.CANCELED;

        runtime.record.updatedAt =
            timestamp;

        runtime.record.completedAt =
            timestamp;


        this.releaseAgentSafely(
            runtime,
            AGENT_STATUS.CANCELED
        );


        const error =
            new BrowserChatRequestError(
                ERROR_CODE.REQUEST_CANCELED,
                `Request "${requestId}" was canceled`,
                {
                    requestId,

                    agentId:
                        runtime.record
                            .agentId
                }
            );


        runtime.deferred.reject(
            error
        );


        await this.emitStatus(
            runtime.record
        );


        logger.info(
            "Browser chat request canceled",
            {
                requestId,

                agentId:
                    runtime.record
                        .agentId
            }
        );


        this.requests.delete(
            requestId
        );


        return true;
    }


    // ========================================================
    // Timeout
    // ========================================================

    private startTimeout(
        runtime:
            RuntimeRequest
    ): void {

        runtime.timer =
            setTimeout(
                () => {

                    void this.handleTimeout(
                        runtime.record
                            .requestId
                    );

                },
                runtime.record.timeoutMs
            );


        runtime.timer.unref?.();
    }


    private async handleTimeout(
        requestId: string
    ): Promise<void> {

        const runtime =
            this.requests.get(
                requestId
            );


        if (
            !runtime ||
            isTerminalStatus(
                runtime.record.status
            )
        ) {

            return;
        }


        /*
         * Best effort: ask browser provider to stop generation.
         */

        try {

            await this.bridgeManager
                .sendToAgent(
                    runtime.record.agentId,
                    createChatCancel(
                        runtime.record.requestId,
                        runtime.record.agentId
                    )
                );

        } catch {
            // Timeout must still complete locally.
        }


        this.clearTimer(
            runtime
        );


        const timestamp =
            now();


        runtime.record.status =
            REQUEST_STATUS.TIMEOUT;

        runtime.record.updatedAt =
            timestamp;

        runtime.record.completedAt =
            timestamp;

        runtime.record.error = {
            code:
                ERROR_CODE.REQUEST_TIMEOUT,

            message:
                `Browser chat request timed out after ${runtime.record.timeoutMs} ms`
        };


        this.releaseAgentSafely(
            runtime,
            AGENT_STATUS.ERROR
        );


        const error =
            new BrowserChatRequestError(
                ERROR_CODE.REQUEST_TIMEOUT,
                runtime.record
                    .error
                    .message,
                {
                    requestId,

                    agentId:
                        runtime.record
                            .agentId
                }
            );


        runtime.deferred.reject(
            error
        );


        await this.emitStatus(
            runtime.record
        );


        logger.warn(
            "Browser chat request timed out",
            {
                requestId,

                agentId:
                    runtime.record
                        .agentId,

                timeoutMs:
                    runtime.record
                        .timeoutMs
            }
        );


        this.requests.delete(
            requestId
        );
    }


    // ========================================================
    // Bridge disconnected
    // ========================================================

    async handleBridgeDisconnected(
        bridgeId: string
    ): Promise<void> {

        const affected =
            Array.from(
                this.requests.values()
            ).filter(
                (runtime) =>
                    runtime.bridgeId ===
                    bridgeId
            );


        for (
            const runtime of
            affected
        ) {

            await this.failRequest(
                runtime,
                new BrowserChatRequestError(
                    ERROR_CODE.BRIDGE_OFFLINE,
                    `Bridge "${bridgeId}" disconnected`,
                    {
                        requestId:
                            runtime.record
                                .requestId,

                        agentId:
                            runtime.record
                                .agentId
                    }
                )
            );
        }
    }


    // ========================================================
    // Status from agent
    // ========================================================

    async handleAgentStatus(
        agentId: string,
        status:
            typeof AGENT_STATUS[
            keyof typeof AGENT_STATUS
            ],
        requestId?:
            string | null
    ): Promise<void> {

        if (!requestId) {
            return;
        }


        const runtime =
            this.requests.get(
                requestId
            );


        if (
            !runtime ||
            runtime.record.agentId !==
            agentId
        ) {

            return;
        }


        if (
            status ===
            AGENT_STATUS.SENDING
        ) {

            await this.setRequestStatus(
                runtime,
                REQUEST_STATUS.SENDING
            );


            return;
        }


        if (
            status ===
            AGENT_STATUS.GENERATING
        ) {

            await this.setRequestStatus(
                runtime,
                REQUEST_STATUS.GENERATING
            );
        }
    }


    // ========================================================
    // Get
    // ========================================================

    get(
        requestId: string
    ): BrowserChatRequest | null {

        const runtime =
            this.requests.get(
                requestId
            );


        return runtime
            ? cloneRequest(
                runtime.record
            )
            : null;
    }


    // ========================================================
    // List
    // ========================================================

    list():
        BrowserChatRequest[] {

        return Array.from(
            this.requests.values()
        ).map(
            (runtime) =>
                cloneRequest(
                    runtime.record
                )
        );
    }


    // ========================================================
    // Active count
    // ========================================================

    count(): number {

        return this.requests.size;
    }


    // ========================================================
    // Request status
    // ========================================================

    private async setRequestStatus(
        runtime:
            RuntimeRequest,
        status:
            BrowserChatRequest["status"]
    ): Promise<void> {

        if (
            isTerminalStatus(
                runtime.record.status
            )
        ) {
            return;
        }


        runtime.record.status =
            status;

        runtime.record.updatedAt =
            now();


        if (
            !runtime.record.startedAt &&
            (
                status ===
                REQUEST_STATUS.SENDING ||
                status ===
                REQUEST_STATUS.GENERATING
            )
        ) {

            runtime.record.startedAt =
                now();
        }


        await this.emitStatus(
            runtime.record
        );
    }


    // ========================================================
    // Emit status
    // ========================================================

    private async emitStatus(
        record:
            BrowserChatRequest
    ): Promise<void> {

        if (
            typeof this.onStatusChange !==
            "function"
        ) {
            return;
        }


        try {

            await this.onStatusChange(
                cloneRequest(
                    record
                )
            );

        } catch (error) {

            logger.error(
                "Request status callback failed",
                error,
                {
                    requestId:
                        record.requestId,

                    agentId:
                        record.agentId
                }
            );
        }
    }


    // ========================================================
    // Agent release
    // ========================================================

    private releaseAgentSafely(
        runtime:
            RuntimeRequest,
        terminalStatus:
            typeof AGENT_STATUS[
            keyof typeof AGENT_STATUS
            ]
    ): void {

        try {

            /*
             * Preserve terminal state momentarily, then return
             * the agent to IDLE so another request can use it.
             */

            this.agentRegistry.setStatus(
                runtime.record.agentId,
                terminalStatus,
                {
                    requestId:
                        runtime.record
                            .requestId
                }
            );


            this.agentRegistry.release(
                runtime.record.agentId,
                runtime.record.requestId,
                AGENT_STATUS.IDLE
            );

        } catch (error) {

            logger.debug(
                "Unable to release agent",
                {
                    requestId:
                        runtime.record
                            .requestId,

                    agentId:
                        runtime.record
                            .agentId,

                    error:
                        getErrorMessage(
                            error
                        )
                }
            );
        }
    }


    // ========================================================
    // Timer
    // ========================================================

    private clearTimer(
        runtime:
            RuntimeRequest
    ): void {

        if (
            runtime.timer !==
            null
        ) {

            clearTimeout(
                runtime.timer
            );


            runtime.timer =
                null;
        }
    }
}


// ============================================================
// Helpers
// ============================================================

function isTerminalStatus(
    status:
        BrowserChatRequest["status"]
): boolean {

    return (
        status ===
        REQUEST_STATUS.COMPLETED ||
        status ===
        REQUEST_STATUS.CANCELED ||
        status ===
        REQUEST_STATUS.TIMEOUT ||
        status ===
        REQUEST_STATUS.ERROR
    );
}


function isChatCompletedResult(
    value: unknown
): value is ChatCompletedResult {

    if (
        value === null ||
        typeof value !==
        "object"
    ) {

        return false;
    }


    const result =
        value as Record<
            string,
            unknown
        >;


    return (
        typeof result.agentId ===
        "string" &&

        result.status ===
        "completed" &&

        typeof result.content ===
        "string"
    );
}


function cloneRequest(
    request:
        BrowserChatRequest
): BrowserChatRequest {

    return {
        ...request,

        message: {
            ...request.message
        },

        ...(request.error
            ? {
                error: {
                    ...request.error
                }
            }
            : {})
    };
}


function normalizeManagerError(
    error: unknown,
    requestId?: string,
    agentId?: string
): BrowserChatRequestError {

    if (
        error instanceof
        BrowserChatRequestError
    ) {

        return error;
    }


    if (
        error instanceof
        AgentRegistryError ||
        error instanceof
        BridgeManagerError
    ) {

        return new BrowserChatRequestError(
            error.code,
            error.message,
            {
                requestId,
                agentId
            }
        );
    }


    return new BrowserChatRequestError(
        ERROR_CODE.INTERNAL_ERROR,
        getErrorMessage(
            error
        ),
        {
            requestId,
            agentId
        }
    );
}