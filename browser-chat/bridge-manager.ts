// browser-chat/bridge-manager.ts

import {
    AGENT_STATUS,
    BRIDGE_STALE_TIMEOUT_MS,
    BRIDGE_STATUS,
    BROWSER_CHAT_SERVER_VERSION,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    ERROR_CODE,
    MESSAGE_TYPE,
    METHOD,
    WS_READY_STATE
} from "./protocol/constants";

import {
    createBridgeRegistered,
    createError,
    serializeMessage
} from "./protocol/messages";

import type {
    AgentRegisterPayload,
    AgentStatusPayload,
    BridgeConnection,
    BridgeHeartbeatPayload,
    BridgeRegisterPayload,
    BrowserChatAgent,
    BrowserChatEnvelope,
    Capability,
    EventEnvelope,
    RequestEnvelope
} from "./protocol/types";

import {
    AgentRegistry,
    AgentRegistryError
} from "./agent-registry";

import {
    createLogger
} from "./shared/logger";

import {
    generateId,
    getErrorMessage,
    now
} from "./shared/utils";


const logger =
    createLogger(
        "BridgeManager"
    );


// ============================================================
// Transport abstraction
// ============================================================

/*
 * BridgeManager deliberately does not import the "ws" package.
 *
 * websocket-server.ts will wrap the real WebSocket connection
 * and provide this minimal transport contract.
 */

export interface BridgeTransport {

    readonly id:
        string;

    readonly remoteAddress?:
        string;

    getReadyState():
        number;

    send(
        data: string
    ):
        void | Promise<void>;

    close?(
        code?: number,
        reason?: string
    ):
        void;
}


// ============================================================
// Runtime bridge
// ============================================================

interface RuntimeBridge {

    connectionId:
        string;

    transport:
        BridgeTransport;

    bridgeId:
        string | null;

    bridgeVersion:
        string | null;

    capabilities:
        Capability[];

    status:
        BridgeConnection["status"];

    connectedAt:
        number;

    registeredAt:
        number | null;

    lastSeenAt:
        number;

    lastHeartbeatAt:
        number | null;
}


// ============================================================
// Options
// ============================================================

export interface BridgeManagerOptions {

    agentRegistry:
        AgentRegistry;

    heartbeatIntervalMs?:
        number;

    staleTimeoutMs?:
        number;

    serverVersion?:
        string;

    /*
     * Optional authentication callback.
     *
     * MVP can omit this. Later BRIDGE_TOKEN can be validated
     * here without changing the protocol routing layer.
     */

    authenticate?: (
        payload:
            BridgeRegisterPayload,
        bridge:
            BridgeConnection | null
    ) =>
        boolean |
        Promise<boolean>;

    onMessage?: (
        message:
            BrowserChatEnvelope,
        bridge:
            BridgeConnection
    ) =>
        void |
        Promise<void>;

    onBridgeRegistered?: (
        bridge:
            BridgeConnection
    ) =>
        void |
        Promise<void>;

    onBridgeDisconnected?: (
        bridge:
            BridgeConnection
    ) =>
        void |
        Promise<void>;

    onAgentRegistered?: (
        agent:
            BrowserChatAgent
    ) =>
        void |
        Promise<void>;

    onAgentUnregistered?: (
        agent:
            BrowserChatAgent
    ) =>
        void |
        Promise<void>;

    onAgentStatus?: (
        agent:
            BrowserChatAgent
    ) =>
        void |
        Promise<void>;
}


// ============================================================
// Errors
// ============================================================

export class BridgeManagerError
    extends Error {

    readonly code:
        string;


    constructor(
        code: string,
        message: string
    ) {

        super(
            message
        );


        this.name =
            "BridgeManagerError";

        this.code =
            code;
    }
}


// ============================================================
// Bridge manager
// ============================================================

export class BridgeManager {

    private readonly agentRegistry:
        AgentRegistry;


    private readonly heartbeatIntervalMs:
        number;


    private readonly staleTimeoutMs:
        number;


    private readonly serverVersion:
        string;


    private readonly authenticate?:
        BridgeManagerOptions["authenticate"];


    private readonly onMessage?:
        BridgeManagerOptions["onMessage"];


    private readonly onBridgeRegistered?:
        BridgeManagerOptions["onBridgeRegistered"];


    private readonly onBridgeDisconnected?:
        BridgeManagerOptions["onBridgeDisconnected"];


    private readonly onAgentRegistered?:
        BridgeManagerOptions["onAgentRegistered"];


    private readonly onAgentUnregistered?:
        BridgeManagerOptions["onAgentUnregistered"];


    private readonly onAgentStatus?:
        BridgeManagerOptions["onAgentStatus"];


    /*
     * connectionId -> runtime bridge
     */

    private readonly connections =
        new Map<
            string,
            RuntimeBridge
        >();


    /*
     * bridgeId -> connectionId
     */

    private readonly bridgeConnections =
        new Map<
            string,
            string
        >();


    private staleTimer:
        ReturnType<
            typeof setInterval
        > | null =
            null;


    constructor(
        options:
            BridgeManagerOptions
    ) {

        this.agentRegistry =
            options.agentRegistry;


        this.heartbeatIntervalMs =
            options.heartbeatIntervalMs ??
            DEFAULT_HEARTBEAT_INTERVAL_MS;


        this.staleTimeoutMs =
            options.staleTimeoutMs ??
            BRIDGE_STALE_TIMEOUT_MS;


        this.serverVersion =
            options.serverVersion ??
            BROWSER_CHAT_SERVER_VERSION;


        this.authenticate =
            options.authenticate;


        this.onMessage =
            options.onMessage;


        this.onBridgeRegistered =
            options.onBridgeRegistered;


        this.onBridgeDisconnected =
            options.onBridgeDisconnected;


        this.onAgentRegistered =
            options.onAgentRegistered;


        this.onAgentUnregistered =
            options.onAgentUnregistered;


        this.onAgentStatus =
            options.onAgentStatus;
    }


    // ========================================================
    // Lifecycle
    // ========================================================

    start(): void {

        if (
            this.staleTimer
        ) {
            return;
        }


        this.staleTimer =
            setInterval(
                () => {

                    void this.checkStaleBridges();

                },
                Math.max(
                    1_000,
                    Math.floor(
                        this.heartbeatIntervalMs
                    )
                )
            );


        /*
         * Do not keep Node alive only because of this timer.
         */

        this.staleTimer.unref?.();


        logger.info(
            "Bridge manager started",
            {
                heartbeatIntervalMs:
                    this.heartbeatIntervalMs,

                staleTimeoutMs:
                    this.staleTimeoutMs
            }
        );
    }


    stop(): void {

        if (
            this.staleTimer
        ) {

            clearInterval(
                this.staleTimer
            );


            this.staleTimer =
                null;
        }


        logger.info(
            "Bridge manager stopped"
        );
    }


    // ========================================================
    // Connection lifecycle
    // ========================================================

    addConnection(
        transport: BridgeTransport
    ): string {

        const connectionId =
            transport.id ||
            generateId(
                "conn"
            );


        if (
            this.connections.has(
                connectionId
            )
        ) {

            throw new BridgeManagerError(
                ERROR_CODE.INTERNAL_ERROR,
                `Connection "${connectionId}" already exists`
            );
        }


        const timestamp =
            now();


        this.connections.set(
            connectionId,
            {
                connectionId,

                transport,

                bridgeId:
                    null,

                bridgeVersion:
                    null,

                capabilities:
                    [],

                status:
                    BRIDGE_STATUS.CONNECTED,

                connectedAt:
                    timestamp,

                registeredAt:
                    null,

                lastSeenAt:
                    timestamp,

                lastHeartbeatAt:
                    null
            }
        );


        logger.info(
            "Browser bridge transport connected",
            {
                connectionId,

                remoteAddress:
                    transport.remoteAddress
            }
        );


        return connectionId;
    }


    async removeConnection(
        connectionId: string
    ): Promise<void> {

        const runtime =
            this.connections.get(
                connectionId
            );


        if (!runtime) {
            return;
        }


        this.connections.delete(
            connectionId
        );


        if (
            runtime.bridgeId
        ) {

            const mappedConnectionId =
                this.bridgeConnections.get(
                    runtime.bridgeId
                );


            if (
                mappedConnectionId ===
                connectionId
            ) {

                this.bridgeConnections.delete(
                    runtime.bridgeId
                );
            }


            const affectedAgents =
                this.agentRegistry
                    .markBridgeOffline(
                        runtime.bridgeId
                    );


            logger.warn(
                "Browser bridge disconnected",
                {
                    bridgeId:
                        runtime.bridgeId,

                    connectionId,

                    agents:
                        affectedAgents.length
                }
            );


            await safeAsyncCall(
                this.onBridgeDisconnected,
                this.toBridgeConnection(
                    runtime,
                    BRIDGE_STATUS.DISCONNECTED
                )
            );

        } else {

            logger.info(
                "Unregistered browser transport disconnected",
                {
                    connectionId
                }
            );
        }
    }


    // ========================================================
    // Inbound message
    // ========================================================

    async handleMessage(
        connectionId: string,
        message: BrowserChatEnvelope
    ): Promise<void> {

        const runtime =
            this.connections.get(
                connectionId
            );


        if (!runtime) {

            throw new BridgeManagerError(
                ERROR_CODE.BRIDGE_NOT_FOUND,
                `Connection "${connectionId}" was not found`
            );
        }


        runtime.lastSeenAt =
            now();


        /*
         * bridge.register is the only message accepted before
         * the connection has registered a logical bridgeId.
         */

        if (
            !runtime.bridgeId
        ) {

            if (
                message.type !==
                    MESSAGE_TYPE.REQUEST ||
                !("method" in message) ||
                message.method !==
                    METHOD.BRIDGE_REGISTER
            ) {

                await this.sendError(
                    runtime,
                    message.id,
                    ERROR_CODE.BRIDGE_NOT_REGISTERED,
                    "Bridge must register before sending messages"
                );


                return;
            }


            await this.handleBridgeRegister(
                runtime,
                message as RequestEnvelope
            );


            return;
        }


        /*
         * A second bridge.register on the same transport is
         * treated as re-registration.
         */

        if (
            message.type ===
                MESSAGE_TYPE.REQUEST &&
            "method" in message &&
            message.method ===
                METHOD.BRIDGE_REGISTER
        ) {

            await this.handleBridgeRegister(
                runtime,
                message as RequestEnvelope
            );


            return;
        }


        if (
            message.type ===
                MESSAGE_TYPE.EVENT &&
            "method" in message
        ) {

            switch (
                message.method
            ) {

                case METHOD.BRIDGE_HEARTBEAT:

                    await this.handleHeartbeat(
                        runtime,
                        message as EventEnvelope
                    );

                    return;


                case METHOD.AGENT_REGISTER:

                    await this.handleAgentRegister(
                        runtime,
                        message as EventEnvelope
                    );

                    return;


                case METHOD.AGENT_UNREGISTER:

                    await this.handleAgentUnregister(
                        runtime,
                        message as EventEnvelope
                    );

                    return;


                case METHOD.AGENT_STATUS:

                    await this.handleAgentStatus(
                        runtime,
                        message as EventEnvelope
                    );

                    return;
            }
        }


        /*
         * chat.delta, chat.error and response envelopes are
         * forwarded to RequestManager through onMessage().
         */

        await safeAsyncCall(
            this.onMessage,
            message,
            this.toBridgeConnection(
                runtime
            )
        );
    }


    // ========================================================
    // bridge.register
    // ========================================================

    private async handleBridgeRegister(
        runtime: RuntimeBridge,
        message: RequestEnvelope
    ): Promise<void> {

        const payload =
            message.payload as
                BridgeRegisterPayload;


        const bridgeId =
            payload.bridgeId.trim();


        if (
            this.authenticate
        ) {

            let authenticated =
                false;


            try {

                authenticated =
                    await this.authenticate(
                        payload,
                        runtime.bridgeId
                            ? this.toBridgeConnection(
                                runtime
                            )
                            : null
                    );

            } catch (error) {

                logger.error(
                    "Bridge authentication failed",
                    error,
                    {
                        bridgeId,
                        connectionId:
                            runtime.connectionId
                    }
                );
            }


            if (!authenticated) {

                await this.sendError(
                    runtime,
                    message.id,
                    ERROR_CODE.BRIDGE_AUTH_FAILED,
                    "Bridge authentication failed"
                );


                return;
            }
        }


        const previousConnectionId =
            this.bridgeConnections.get(
                bridgeId
            );


        /*
         * A new connection with the same bridgeId replaces the
         * old transport. This is important for MV3 reconnects.
         */

        if (
            previousConnectionId &&
            previousConnectionId !==
                runtime.connectionId
        ) {

            const previous =
                this.connections.get(
                    previousConnectionId
                );


            if (previous) {

                logger.warn(
                    "Replacing existing bridge connection",
                    {
                        bridgeId,

                        previousConnectionId,

                        connectionId:
                            runtime.connectionId
                    }
                );


                previous.status =
                    BRIDGE_STATUS.DISCONNECTED;


                try {

                    previous.transport.close?.(
                        1000,
                        "Bridge reconnected"
                    );

                } catch {
                    // Ignore transport close errors.
                }


                this.connections.delete(
                    previousConnectionId
                );
            }
        }


        /*
         * If this connection previously represented another
         * bridgeId, remove the old mapping.
         */

        if (
            runtime.bridgeId &&
            runtime.bridgeId !==
                bridgeId
        ) {

            const oldMapping =
                this.bridgeConnections.get(
                    runtime.bridgeId
                );


            if (
                oldMapping ===
                runtime.connectionId
            ) {

                this.bridgeConnections.delete(
                    runtime.bridgeId
                );
            }


            this.agentRegistry
                .markBridgeOffline(
                    runtime.bridgeId
                );
        }


        runtime.bridgeId =
            bridgeId;

        runtime.bridgeVersion =
            payload.bridgeVersion;

        runtime.capabilities =
            normalizeCapabilities(
                payload.capabilities
            );

        runtime.status =
            BRIDGE_STATUS.READY;

        runtime.registeredAt =
            now();

        runtime.lastSeenAt =
            now();

        runtime.lastHeartbeatAt =
            now();


        this.bridgeConnections.set(
            bridgeId,
            runtime.connectionId
        );


        await this.sendEnvelope(
            runtime,
            createBridgeRegistered(
                message.id,
                bridgeId,
                {
                    accepted:
                        true,

                    heartbeatIntervalMs:
                        this.heartbeatIntervalMs,

                    serverVersion:
                        this.serverVersion
                }
            )
        );


        logger.info(
            "Browser bridge registered",
            {
                bridgeId,

                bridgeVersion:
                    runtime.bridgeVersion,

                connectionId:
                    runtime.connectionId,

                capabilities:
                    runtime.capabilities
            }
        );


        await safeAsyncCall(
            this.onBridgeRegistered,
            this.toBridgeConnection(
                runtime
            )
        );
    }


    // ========================================================
    // Heartbeat
    // ========================================================

    private async handleHeartbeat(
        runtime: RuntimeBridge,
        message: EventEnvelope
    ): Promise<void> {

        const payload =
            message.payload as
                BridgeHeartbeatPayload;


        if (
            payload.bridgeId !==
            runtime.bridgeId
        ) {

            await this.sendError(
                runtime,
                message.id,
                ERROR_CODE.REQUEST_MISMATCH,
                "Heartbeat bridgeId does not match connection"
            );


            return;
        }


        runtime.lastHeartbeatAt =
            now();

        runtime.lastSeenAt =
            now();

        runtime.status =
            BRIDGE_STATUS.READY;
    }


    // ========================================================
    // agent.register
    // ========================================================

    private async handleAgentRegister(
        runtime: RuntimeBridge,
        message: EventEnvelope
    ): Promise<void> {

        const payload =
            message.payload as
                AgentRegisterPayload;


        if (
            payload.bridgeId !==
            runtime.bridgeId
        ) {

            await this.sendError(
                runtime,
                message.id,
                ERROR_CODE.REQUEST_MISMATCH,
                "Agent bridgeId does not match connection"
            );


            return;
        }


        try {

            const agent =
                this.agentRegistry
                    .register(
                        payload
                    );


            await safeAsyncCall(
                this.onAgentRegistered,
                agent
            );

        } catch (error) {

            await this.sendRegistryError(
                runtime,
                message.id,
                error
            );
        }
    }


    // ========================================================
    // agent.unregister
    // ========================================================

    private async handleAgentUnregister(
        runtime: RuntimeBridge,
        message: EventEnvelope
    ): Promise<void> {

        const payload =
            message.payload as {
                bridgeId:
                    string;

                agentId:
                    string;

                reason?:
                    string;
            };


        if (
            payload.bridgeId !==
            runtime.bridgeId
        ) {

            await this.sendError(
                runtime,
                message.id,
                ERROR_CODE.REQUEST_MISMATCH,
                "Agent bridgeId does not match connection"
            );


            return;
        }


        try {

            const agent =
                this.agentRegistry
                    .unregister(
                        payload.agentId,
                        runtime.bridgeId
                    );


            if (agent) {

                await safeAsyncCall(
                    this.onAgentUnregistered,
                    agent
                );
            }

        } catch (error) {

            await this.sendRegistryError(
                runtime,
                message.id,
                error
            );
        }
    }


    // ========================================================
    // agent.status
    // ========================================================

    private async handleAgentStatus(
        runtime: RuntimeBridge,
        message: EventEnvelope
    ): Promise<void> {

        const payload =
            message.payload as
                AgentStatusPayload;


        const existing =
            this.agentRegistry.get(
                payload.agentId
            );


        if (!existing) {

            await this.sendError(
                runtime,
                message.id,
                ERROR_CODE.AGENT_NOT_FOUND,
                `Agent "${payload.agentId}" is not registered`
            );


            return;
        }


        if (
            existing.bridgeId !==
            runtime.bridgeId
        ) {

            await this.sendError(
                runtime,
                message.id,
                ERROR_CODE.REQUEST_MISMATCH,
                "Agent does not belong to this bridge"
            );


            return;
        }


        try {

            const agent =
                this.agentRegistry
                    .applyStatus({
                        ...payload,

                        bridgeId:
                            runtime.bridgeId
                    });


            await safeAsyncCall(
                this.onAgentStatus,
                agent
            );

        } catch (error) {

            await this.sendRegistryError(
                runtime,
                message.id,
                error
            );
        }
    }


    // ========================================================
    // Send to agent
    // ========================================================

    async sendToAgent(
        agentId: string,
        message: BrowserChatEnvelope
    ): Promise<void> {

        const agent =
            this.agentRegistry.get(
                agentId
            );


        if (!agent) {

            throw new BridgeManagerError(
                ERROR_CODE.AGENT_NOT_FOUND,
                `Agent "${agentId}" was not found`
            );
        }


        if (
            agent.status ===
            AGENT_STATUS.OFFLINE
        ) {

            throw new BridgeManagerError(
                ERROR_CODE.AGENT_OFFLINE,
                `Agent "${agentId}" is offline`
            );
        }


        if (
            !agent.bridgeId
        ) {

            throw new BridgeManagerError(
                ERROR_CODE.BRIDGE_NOT_FOUND,
                `Agent "${agentId}" has no bridge`
            );
        }


        await this.sendToBridge(
            agent.bridgeId,
            message
        );
    }


    // ========================================================
    // Send to bridge
    // ========================================================

    async sendToBridge(
        bridgeId: string,
        message: BrowserChatEnvelope
    ): Promise<void> {

        const runtime =
            this.getRuntimeByBridgeId(
                bridgeId
            );


        if (!runtime) {

            throw new BridgeManagerError(
                ERROR_CODE.BRIDGE_OFFLINE,
                `Bridge "${bridgeId}" is offline`
            );
        }


        await this.sendEnvelope(
            runtime,
            message
        );
    }


    // ========================================================
    // Get bridge
    // ========================================================

    getBridge(
        bridgeId: string
    ): BridgeConnection | null {

        const runtime =
            this.getRuntimeByBridgeId(
                bridgeId
            );


        return runtime
            ? this.toBridgeConnection(
                runtime
            )
            : null;
    }


    // ========================================================
    // List bridges
    // ========================================================

    listBridges():
        BridgeConnection[] {

        const result:
            BridgeConnection[] = [];


        for (
            const runtime of
            this.connections.values()
        ) {

            if (
                !runtime.bridgeId
            ) {
                continue;
            }


            result.push(
                this.toBridgeConnection(
                    runtime
                )
            );
        }


        return result;
    }


    // ========================================================
    // Bridge availability
    // ========================================================

    isBridgeReady(
        bridgeId: string
    ): boolean {

        const runtime =
            this.getRuntimeByBridgeId(
                bridgeId
            );


        return Boolean(
            runtime &&
            runtime.status ===
                BRIDGE_STATUS.READY &&
            runtime.transport
                .getReadyState() ===
                WS_READY_STATE.OPEN
        );
    }


    // ========================================================
    // Stale bridge detection
    // ========================================================

    async checkStaleBridges():
        Promise<void> {

        const timestamp =
            now();


        const staleConnections:
            string[] = [];


        for (
            const runtime of
            this.connections.values()
        ) {

            if (
                !runtime.bridgeId
            ) {
                continue;
            }


            const elapsed =
                timestamp -
                runtime.lastSeenAt;


            if (
                elapsed >
                this.staleTimeoutMs
            ) {

                staleConnections.push(
                    runtime.connectionId
                );
            }
        }


        for (
            const connectionId of
            staleConnections
        ) {

            const runtime =
                this.connections.get(
                    connectionId
                );


            if (!runtime) {
                continue;
            }


            logger.warn(
                "Browser bridge became stale",
                {
                    bridgeId:
                        runtime.bridgeId,

                    connectionId,

                    lastSeenAt:
                        runtime.lastSeenAt
                }
            );


            try {

                runtime.transport.close?.(
                    1001,
                    "Bridge heartbeat timeout"
                );

            } catch {
                // Ignore close errors.
            }


            await this.removeConnection(
                connectionId
            );
        }
    }


    // ========================================================
    // Internal send
    // ========================================================

    private async sendEnvelope(
        runtime: RuntimeBridge,
        message: BrowserChatEnvelope
    ): Promise<void> {

        if (
            runtime.transport
                .getReadyState() !==
            WS_READY_STATE.OPEN
        ) {

            throw new BridgeManagerError(
                ERROR_CODE.CONNECTION_CLOSED,
                "Bridge WebSocket is not open"
            );
        }


        try {

            await runtime.transport.send(
                serializeMessage(
                    message
                )
            );

        } catch (error) {

            throw new BridgeManagerError(
                ERROR_CODE.SEND_FAILED,
                getErrorMessage(
                    error,
                    "Failed to send bridge message"
                )
            );
        }
    }


    // ========================================================
    // Error send
    // ========================================================

    private async sendError(
        runtime: RuntimeBridge,
        requestId: string | null | undefined,
        code: string,
        message: string,
        details?: unknown
    ): Promise<void> {

        try {

            await this.sendEnvelope(
                runtime,
                createError(
                    requestId,
                    code,
                    message,
                    details
                )
            );

        } catch (error) {

            logger.error(
                "Failed to send bridge error",
                error,
                {
                    bridgeId:
                        runtime.bridgeId,

                    connectionId:
                        runtime.connectionId,

                    code
                }
            );
        }
    }


    // ========================================================
    // Registry error
    // ========================================================

    private async sendRegistryError(
        runtime: RuntimeBridge,
        requestId: string,
        error: unknown
    ): Promise<void> {

        if (
            error instanceof
            AgentRegistryError
        ) {

            await this.sendError(
                runtime,
                requestId,
                error.code,
                error.message
            );


            return;
        }


        await this.sendError(
            runtime,
            requestId,
            ERROR_CODE.INTERNAL_ERROR,
            getErrorMessage(
                error
            )
        );
    }


    // ========================================================
    // Lookup
    // ========================================================

    private getRuntimeByBridgeId(
        bridgeId: string
    ): RuntimeBridge | null {

        const connectionId =
            this.bridgeConnections.get(
                bridgeId
            );


        if (!connectionId) {
            return null;
        }


        return (
            this.connections.get(
                connectionId
            ) ??
            null
        );
    }


    // ========================================================
    // Public bridge representation
    // ========================================================

    private toBridgeConnection(
        runtime: RuntimeBridge,
        statusOverride?:
            BridgeConnection["status"]
    ): BridgeConnection {

        return {
            bridgeId:
                runtime.bridgeId ??
                runtime.connectionId,

            status:
                statusOverride ??
                runtime.status,

            connectedAt:
                runtime.connectedAt,

            lastSeenAt:
                runtime.lastSeenAt,

            capabilities:
                [
                    ...runtime.capabilities
                ],

            ...(runtime.bridgeVersion
                ? {
                    bridgeVersion:
                        runtime.bridgeVersion
                }
                : {}),

            ...(runtime.transport
                .remoteAddress
                ? {
                    remoteAddress:
                        runtime.transport
                            .remoteAddress
                }
                : {})
        };
    }
}


// ============================================================
// Helpers
// ============================================================

function normalizeCapabilities(
    capabilities:
        Capability[] |
        undefined
): Capability[] {

    if (
        !Array.isArray(
            capabilities
        )
    ) {

        return [];
    }


    return Array.from(
        new Set(
            capabilities.filter(
                (
                    capability
                ): capability is Capability =>
                    typeof capability ===
                        "string" &&
                    capability.length >
                        0
            )
        )
    );
}


async function safeAsyncCall<
    TArgs extends unknown[]
>(
    callback:
        | ((
            ...args: TArgs
        ) =>
            void |
            Promise<void>)
        | undefined,

    ...args: TArgs
): Promise<void> {

    if (
        typeof callback !==
        "function"
    ) {
        return;
    }


    try {

        await callback(
            ...args
        );

    } catch (error) {

        logger.error(
            "Bridge callback failed",
            error
        );
    }
}