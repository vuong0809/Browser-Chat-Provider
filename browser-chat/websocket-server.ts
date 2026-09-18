// browser-chat/websocket-server.ts

import {
    WebSocket,
    WebSocketServer as NodeWebSocketServer
} from "ws";

import type {
    IncomingMessage
} from "node:http";

import type {
    Duplex
} from "node:stream";

import {
    DEFAULT_WS_HOST,
    DEFAULT_WS_PATH,
    DEFAULT_WS_PORT,
    ERROR_CODE,
    WS_CLOSE_CODE,
    WS_READY_STATE
} from "./protocol/constants";

import {
    createError,
    serializeMessage
} from "./protocol/messages";

import {
    parseAndValidateMessage
} from "./protocol/validator";

import {
    BridgeManager
} from "./bridge-manager";

import type {
    BridgeTransport
} from "./bridge-manager";

import {
    createLogger
} from "./shared/logger";

import {
    generateId,
    getErrorMessage
} from "./shared/utils";


const logger =
    createLogger(
        "WebSocketServer"
    );


// ============================================================
// Mode
// ============================================================

export type BrowserChatWebSocketMode =
    "standalone" |
    "attached";


// ============================================================
// Options
// ============================================================

export interface BrowserChatWebSocketServerOptions {

    bridgeManager:
        BridgeManager;

    mode?:
        BrowserChatWebSocketMode;

    host?:
        string;

    port?:
        number;

    path?:
        string;

    maxPayloadBytes?:
        number;
}


// ============================================================
// Server
// ============================================================

export class BrowserChatWebSocketServer {

    private readonly bridgeManager:
        BridgeManager;

    private readonly mode:
        BrowserChatWebSocketMode;

    private readonly host:
        string;

    private readonly port:
        number;

    private readonly path:
        string;

    private readonly maxPayloadBytes:
        number;

    private server:
        NodeWebSocketServer | null =
            null;

    private starting:
        Promise<void> | null =
            null;


    constructor(
        options:
            BrowserChatWebSocketServerOptions
    ) {

        this.bridgeManager =
            options.bridgeManager;

        this.mode =
            options.mode ??
            "standalone";

        this.host =
            options.host ??
            DEFAULT_WS_HOST;

        this.port =
            options.port ??
            DEFAULT_WS_PORT;

        this.path =
            normalizePath(
                options.path ??
                DEFAULT_WS_PATH
            );

        this.maxPayloadBytes =
            normalizeMaxPayload(
                options.maxPayloadBytes
            );
    }


    // ========================================================
    // Start
    // ========================================================

    async start():
        Promise<void> {

        if (
            this.server
        ) {
            return;
        }

        if (
            this.starting
        ) {
            return this.starting;
        }

        this.starting =
            this.startInternal();

        try {

            await this.starting;

        } finally {

            this.starting =
                null;
        }
    }


    private async startInternal():
        Promise<void> {

        if (
            this.mode ===
            "attached"
        ) {

            this.startAttached();

            return;
        }

        await this.startStandalone();
    }


    // ========================================================
    // Attached mode
    // ========================================================

    private startAttached():
        void {

        const server =
            new NodeWebSocketServer({

                noServer:
                    true,

                maxPayload:
                    this.maxPayloadBytes,

                perMessageDeflate:
                    false,

                clientTracking:
                    true
            });

        this.server =
            server;

        this.attachServerEvents(
            server
        );

        logger.info(
            "Browser Chat WebSocket server initialized in attached mode",
            {
                path:
                    this.path,

                maxPayloadBytes:
                    this.maxPayloadBytes
            }
        );
    }


    // ========================================================
    // Standalone mode
    // ========================================================

    private async startStandalone():
        Promise<void> {

        const server =
            new NodeWebSocketServer({

                host:
                    this.host,

                port:
                    this.port,

                path:
                    this.path,

                maxPayload:
                    this.maxPayloadBytes,

                perMessageDeflate:
                    false,

                clientTracking:
                    true
            });

        /*
         * Store early so stop() can still close a server that is
         * currently starting.
         */

        this.server =
            server;

        this.attachServerEvents(
            server
        );


        await new Promise<void>(
            (
                resolve,
                reject
            ) => {

                const onListening =
                    () => {

                        cleanup();

                        resolve();
                    };


                const onError =
                    (
                        error:
                            Error
                    ) => {

                        cleanup();

                        reject(
                            error
                        );
                    };


                const cleanup =
                    () => {

                        server.off(
                            "listening",
                            onListening
                        );

                        server.off(
                            "error",
                            onError
                        );
                    };


                server.once(
                    "listening",
                    onListening
                );

                server.once(
                    "error",
                    onError
                );
            }
        ).catch(
            (error) => {

                if (
                    this.server ===
                    server
                ) {
                    this.server =
                        null;
                }

                try {

                    server.close();

                } catch {
                    // Ignore startup cleanup failure.
                }

                throw error;
            }
        );


        logger.info(
            "Browser Chat WebSocket server listening",
            {
                url:
                    this.getUrl(),

                maxPayloadBytes:
                    this.maxPayloadBytes
            }
        );
    }


    // ========================================================
    // Common server events
    // ========================================================

    private attachServerEvents(
        server:
            NodeWebSocketServer
    ): void {

        server.on(
            "connection",
            (
                socket,
                request
            ) => {

                this.handleConnection(
                    socket,
                    request
                );
            }
        );


        server.on(
            "error",
            (error) => {

                logger.error(
                    "Browser Chat WebSocket server error",
                    error,
                    {
                        mode:
                            this.mode,

                        host:
                            this.host,

                        port:
                            this.port,

                        path:
                            this.path
                    }
                );
            }
        );
    }


    // ========================================================
    // HTTP upgrade integration
    // ========================================================

    isUpgradeRequest(
        request:
            IncomingMessage
    ): boolean {

        const upgrade =
            String(
                request.headers
                    .upgrade ??
                ""
            )
                .trim()
                .toLowerCase();


        if (
            upgrade !==
            "websocket"
        ) {
            return false;
        }


        try {

            const url =
                new URL(
                    request.url ??
                        "/",
                    "http://127.0.0.1"
                );


            return (
                url.pathname ===
                this.path
            );

        } catch {

            return false;
        }
    }


    handleUpgrade(
        request:
            IncomingMessage,

        socket:
            Duplex,

        head:
            Buffer
    ): boolean {

        if (
            this.mode !==
            "attached"
        ) {

            return false;
        }


        const server =
            this.server;


        if (
            !server
        ) {

            logger.warn(
                "Browser Chat upgrade received before WebSocket server initialization",
                {
                    path:
                        request.url
                }
            );

            return false;
        }


        if (
            !this.isUpgradeRequest(
                request
            )
        ) {

            return false;
        }


        try {

            server.handleUpgrade(
                request,
                socket,
                head,
                (
                    websocket
                ) => {

                    server.emit(
                        "connection",
                        websocket,
                        request
                    );
                }
            );


            return true;

        } catch (error) {

            logger.error(
                "Browser Chat WebSocket upgrade failed",
                error,
                {
                    path:
                        request.url,

                    remoteAddress:
                        getRemoteAddress(
                            request
                        )
                }
            );


            try {

                socket.destroy();

            } catch {
                // Ignore socket cleanup failure.
            }


            return true;
        }
    }


    // ========================================================
    // Stop
    // ========================================================

    async stop():
        Promise<void> {

        const server =
            this.server;


        if (!server) {
            return;
        }


        this.server =
            null;


        /*
         * Close clients first so BridgeManager receives normal
         * disconnect events and marks their agents offline.
         */

        for (
            const socket of
            server.clients
        ) {

            try {

                socket.close(
                    WS_CLOSE_CODE.NORMAL,
                    "Browser Chat server stopping"
                );

            } catch {
                // Ignore individual socket close errors.
            }
        }


        /*
         * In attached/noServer mode WebSocketServer does not own
         * the HTTP listener. close() only closes WebSocket clients
         * and WebSocketServer resources.
         */

        await new Promise<void>(
            (resolve) => {

                try {

                    server.close(
                        () => {
                            resolve();
                        }
                    );

                } catch {

                    resolve();
                }
            }
        );


        logger.info(
            "Browser Chat WebSocket server stopped",
            {
                mode:
                    this.mode
            }
        );
    }


    // ========================================================
    // Connection
    // ========================================================

    private handleConnection(
        socket: WebSocket,
        request:
            IncomingMessage
    ): void {

        const connectionId =
            generateId(
                "conn"
            );


        const remoteAddress =
            getRemoteAddress(
                request
            );


        const transport:
            BridgeTransport = {

            id:
                connectionId,

            remoteAddress,

            getReadyState() {

                return socket.readyState;
            },

            send(
                data: string
            ) {

                return new Promise<void>(
                    (
                        resolve,
                        reject
                    ) => {

                        if (
                            socket.readyState !==
                            WebSocket.OPEN
                        ) {

                            reject(
                                new Error(
                                    "WebSocket is not open"
                                )
                            );

                            return;
                        }


                        socket.send(
                            data,
                            (error) => {

                                if (error) {

                                    reject(
                                        error
                                    );

                                    return;
                                }

                                resolve();
                            }
                        );
                    }
                );
            },

            close(
                code?: number,
                reason?: string
            ) {

                if (
                    socket.readyState ===
                        WebSocket.CLOSED ||
                    socket.readyState ===
                        WebSocket.CLOSING
                ) {
                    return;
                }


                socket.close(
                    code,
                    reason
                );
            }
        };


        try {

            this.bridgeManager
                .addConnection(
                    transport
                );

        } catch (error) {

            logger.error(
                "Unable to register WebSocket connection",
                error,
                {
                    connectionId,
                    remoteAddress
                }
            );


            socket.close(
                WS_CLOSE_CODE.INTERNAL_ERROR,
                "Unable to initialize bridge connection"
            );


            return;
        }


        logger.info(
            "Browser extension connected",
            {
                connectionId,
                remoteAddress
            }
        );


        socket.on(
            "message",
            (
                data,
                isBinary
            ) => {

                void this.handleSocketMessage(
                    connectionId,
                    socket,
                    data,
                    isBinary
                );
            }
        );


        socket.on(
            "close",
            (
                code,
                reason
            ) => {

                logger.info(
                    "Browser extension socket closed",
                    {
                        connectionId,

                        remoteAddress,

                        code,

                        reason:
                            reason
                                .toString(
                                    "utf8"
                                )
                                .slice(
                                    0,
                                    200
                                )
                    }
                );


                void this.bridgeManager
                    .removeConnection(
                        connectionId
                    );
            }
        );


        socket.on(
            "error",
            (error) => {

                logger.error(
                    "Browser extension socket error",
                    error,
                    {
                        connectionId,
                        remoteAddress
                    }
                );
            }
        );


        socket.on(
            "pong",
            () => {

                logger.debug(
                    "WebSocket pong received",
                    {
                        connectionId
                    }
                );
            }
        );
    }


    // ========================================================
    // Inbound message
    // ========================================================

    private async handleSocketMessage(
        connectionId: string,
        socket: WebSocket,
        data: unknown,
        isBinary: boolean
    ): Promise<void> {

        if (isBinary) {

            await this.sendProtocolError(
                socket,
                null,
                ERROR_CODE.INVALID_MESSAGE,
                "Binary Browser Chat messages are not supported"
            );

            return;
        }


        const validation =
            parseAndValidateMessage(
                data
            );


        if (!validation.valid) {

            logger.warn(
                "Invalid Browser Chat message",
                {
                    connectionId,

                    validationError:
                        validation.error,

                    path:
                        validation.path
                }
            );


            const requestId =
                tryExtractMessageId(
                    data
                );


            await this.sendProtocolError(
                socket,
                requestId,
                ERROR_CODE.INVALID_MESSAGE,
                validation.error,
                validation.path
                    ? {
                        path:
                            validation.path
                    }
                    : undefined
            );


            return;
        }


        try {

            await this.bridgeManager
                .handleMessage(
                    connectionId,
                    validation.message
                );

        } catch (error) {

            logger.error(
                "Failed to handle Browser Chat message",
                error,
                {
                    connectionId,

                    messageId:
                        validation.message.id,

                    type:
                        validation.message.type
                }
            );


            await this.sendProtocolError(
                socket,
                validation.message.id,
                getErrorCode(
                    error
                ),
                getErrorMessage(
                    error,
                    "Failed to process Browser Chat message"
                )
            );
        }
    }


    // ========================================================
    // Send protocol error
    // ========================================================

    private async sendProtocolError(
        socket: WebSocket,
        requestId:
            string |
            null,
        code: string,
        message: string,
        details?: unknown
    ): Promise<void> {

        if (
            socket.readyState !==
            WS_READY_STATE.OPEN
        ) {
            return;
        }


        const envelope =
            createError(
                requestId,
                code,
                message,
                details
            );


        try {

            await new Promise<void>(
                (
                    resolve,
                    reject
                ) => {

                    socket.send(
                        serializeMessage(
                            envelope
                        ),
                        (error) => {

                            if (error) {

                                reject(
                                    error
                                );

                                return;
                            }


                            resolve();
                        }
                    );
                }
            );

        } catch (error) {

            logger.error(
                "Unable to send protocol error",
                error,
                {
                    requestId,
                    code
                }
            );
        }
    }


    // ========================================================
    // State
    // ========================================================

    isRunning():
        boolean {

        return (
            this.server !==
            null
        );
    }


    getConnectionCount():
        number {

        return (
            this.server
                ?.clients
                .size ??
            0
        );
    }


    getMode():
        BrowserChatWebSocketMode {

        return this.mode;
    }


    getUrl():
        string {

        return (
            `ws://${this.host}:${this.port}${this.path}`
        );
    }


    getHost():
        string {

        return this.host;
    }


    getPort():
        number {

        return this.port;
    }


    getPath():
        string {

        return this.path;
    }
}


// ============================================================
// Helpers
// ============================================================

function normalizePath(
    path: string
): string {

    const trimmed =
        String(
            path ??
            ""
        ).trim();


    if (!trimmed) {

        return "/";
    }


    return trimmed.startsWith(
        "/"
    )
        ? trimmed
        : `/${trimmed}`;
}


function normalizeMaxPayload(
    value:
        number |
        undefined
): number {

    const fallback =
        1024 *
        1024;


    if (
        value === undefined ||
        !Number.isFinite(
            value
        )
    ) {

        return fallback;
    }


    return Math.max(
        1024,
        Math.floor(
            value
        )
    );
}


function getRemoteAddress(
    request:
        IncomingMessage
): string | undefined {

    return (
        request.socket
            .remoteAddress ??
        undefined
    );
}


// ============================================================
// Extract ID from invalid message
// ============================================================

function tryExtractMessageId(
    data: unknown
): string | null {

    try {

        let value:
            unknown = data;


        if (
            typeof value !==
            "string"
        ) {

            if (
                Buffer.isBuffer(
                    value
                )
            ) {

                value =
                    value.toString(
                        "utf8"
                    );

            } else if (
                value instanceof
                ArrayBuffer
            ) {

                value =
                    new TextDecoder()
                        .decode(
                            value
                        );

            } else if (
                ArrayBuffer.isView(
                    value
                )
            ) {

                const view =
                    value as
                        ArrayBufferView;


                value =
                    new TextDecoder()
                        .decode(
                            new Uint8Array(
                                view.buffer,
                                view.byteOffset,
                                view.byteLength
                            )
                        );
            }
        }


        if (
            typeof value ===
            "string"
        ) {

            value =
                JSON.parse(
                    value
                );
        }


        if (
            value &&
            typeof value ===
                "object" &&
            "id" in value
        ) {

            const id =
                (
                    value as {
                        id?: unknown;
                    }
                ).id;


            if (
                typeof id ===
                    "string" &&
                id.length > 0
            ) {

                return id;
            }
        }

    } catch {

        // Invalid JSON has no usable request ID.
    }


    return null;
}


// ============================================================
// Error code extraction
// ============================================================

function getErrorCode(
    error: unknown
): string {

    if (
        error &&
        typeof error ===
            "object" &&
        "code" in error
    ) {

        const code =
            (
                error as {
                    code?: unknown;
                }
            ).code;


        if (
            typeof code ===
                "string" &&
            code.length > 0
        ) {

            return code;
        }
    }


    return ERROR_CODE.INTERNAL_ERROR;
}

