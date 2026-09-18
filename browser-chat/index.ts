// browser-chat/index.ts

import type {
    IncomingMessage
} from "node:http";

import type {
    Duplex
} from "node:stream";

import {
    DEFAULT_CONFIG
} from "./protocol/constants";

import type {
    AgentStatusPayload,
    BrowserChatEnvelope,
    BridgeConnection,
    BridgeRegisterPayload
} from "./protocol/types";

import {
    AgentRegistry
} from "./agent-registry";

import {
    BridgeManager
} from "./bridge-manager";

import {
    RequestManager
} from "./request-manager";

import {
    RequestQueue
} from "./request-queue";

import {
    BrowserChatWebSocketServer
} from "./websocket-server";

import type {
    BrowserChatWebSocketMode
} from "./websocket-server";

import {
    BrowserChatListTool,
    browserChatListToolDefinition
} from "./tools/browser-chat-list";

import {
    BrowserChatAskTool,
    browserChatAskToolDefinition
} from "./tools/browser-chat-ask";

import {
    BrowserChatCancelTool,
    browserChatCancelToolDefinition
} from "./tools/browser-chat-cancel";

import {
    createLogger
} from "./shared/logger";

import {
    getErrorMessage
} from "./shared/utils";


const logger =
    createLogger(
        "BrowserChat"
    );


// ============================================================
// Configuration
// ============================================================

export interface BrowserChatModuleOptions {

    /*
     * standalone:
     *
     * Browser Chat owns its own TCP/WebSocket listener.
     *
     * attached:
     *
     * Browser Chat creates WebSocketServer({ noServer: true })
     * and the host application forwards HTTP upgrade requests
     * through handleUpgrade().
     *
     * Host integrations that already own an HTTP server should use "attached".
     */

    websocketMode?:
    BrowserChatWebSocketMode;

    host?:
    string;

    port?:
    number;

    path?:
    string;

    maxPayloadBytes?:
    number;

    requestQueueSize?:
    number;

    /*
     * Optional bridge authentication.
     *
     * MVP may omit this.
     *
     * Later this can validate BRIDGE_TOKEN from
     * chrome.storage.local.
     */

    authenticateBridge?: (
        payload: BridgeRegisterPayload,
        bridge: BridgeConnection | null
    ) =>
        boolean |
        Promise<boolean>;
}


// ============================================================
// Tool bundle
// ============================================================

export interface BrowserChatTools {

    list:
    BrowserChatListTool;

    ask:
    BrowserChatAskTool;

    cancel:
    BrowserChatCancelTool;
}


// ============================================================
// Tool definitions
// ============================================================

export const browserChatToolDefinitions = [

    browserChatListToolDefinition,

    browserChatAskToolDefinition,

    browserChatCancelToolDefinition

] as const;


// ============================================================
// Module
// ============================================================

export class BrowserChatModule {

    readonly agentRegistry:
        AgentRegistry;


    readonly bridgeManager:
        BridgeManager;


    readonly requestManager:
        RequestManager;


    readonly requestQueue:
        RequestQueue;


    readonly websocketServer:
        BrowserChatWebSocketServer;


    readonly tools:
        BrowserChatTools;


    private started =
        false;


    private starting:
        Promise<void> | null =
        null;


    private stopping:
        Promise<void> | null =
        null;


    constructor(
        options:
            BrowserChatModuleOptions = {}
    ) {

        // ----------------------------------------------------
        // Agent registry
        // ----------------------------------------------------

        this.agentRegistry =
            new AgentRegistry({

                /*
                 * V1:
                 *
                 * Do not allow another bridge to silently take
                 * ownership of an existing agent.
                 */

                allowBridgeTakeover:
                    false
            });


        // ----------------------------------------------------
        // Request queue
        // ----------------------------------------------------

        this.requestQueue =
            new RequestQueue({

                maxSize:
                    options.requestQueueSize ??
                    DEFAULT_CONFIG.requestQueueSize
            });


        // ----------------------------------------------------
        // Bridge manager
        // ----------------------------------------------------

        this.bridgeManager =
            new BridgeManager({

                agentRegistry:
                    this.agentRegistry,


                authenticate:
                    options.authenticateBridge,


                // --------------------------------------------
                // Messages not consumed by BridgeManager
                // --------------------------------------------

                onMessage:
                    async (
                        message:
                            BrowserChatEnvelope
                    ) => {

                        await this.requestManager
                            .handleMessage(
                                message
                            );
                    },


                // --------------------------------------------
                // Bridge disconnected
                // --------------------------------------------

                onBridgeDisconnected:
                    async (
                        bridge
                    ) => {

                        logger.warn(
                            "Browser bridge disconnected",
                            {
                                bridgeId:
                                    bridge.bridgeId
                            }
                        );


                        await this.requestManager
                            .handleBridgeDisconnected(
                                bridge.bridgeId
                            );
                    },


                // --------------------------------------------
                // Agent registered
                // --------------------------------------------

                onAgentRegistered:
                    async (
                        agent
                    ) => {

                        logger.info(
                            "Browser chat agent registered",
                            {
                                agentId:
                                    agent.agentId,

                                bridgeId:
                                    agent.bridgeId,

                                provider:
                                    agent.provider,

                                status:
                                    agent.status
                            }
                        );
                    },


                // --------------------------------------------
                // Agent unregistered
                // --------------------------------------------

                onAgentUnregistered:
                    async (
                        agent
                    ) => {

                        logger.info(
                            "Browser chat agent unregistered",
                            {
                                agentId:
                                    agent.agentId,

                                bridgeId:
                                    agent.bridgeId
                            }
                        );
                    },


                // --------------------------------------------
                // Agent status
                // --------------------------------------------

                onAgentStatus:
                    async (
                        payload:
                            AgentStatusPayload
                    ) => {

                        await this.requestManager
                            .handleAgentStatus(
                                payload.agentId,
                                payload.status
                            );
                    }
            });


        // ----------------------------------------------------
        // Request manager
        // ----------------------------------------------------

        this.requestManager =
            new RequestManager({

                agentRegistry:
                    this.agentRegistry,

                bridgeManager:
                    this.bridgeManager,


                onStatusChange:
                    (
                        request
                    ) => {

                        logger.debug(
                            "Browser chat request status changed",
                            {
                                requestId:
                                    request.requestId,

                                agentId:
                                    request.agentId,

                                status:
                                    request.status
                            }
                        );
                    }
            });


        // ----------------------------------------------------
        // WebSocket server
        // ----------------------------------------------------

        this.websocketServer =
            new BrowserChatWebSocketServer({

                bridgeManager:
                    this.bridgeManager,

                mode:
                    options.websocketMode ??
                    "standalone",

                host:
                    options.host,

                port:
                    options.port,

                path:
                    options.path,

                maxPayloadBytes:
                    options.maxPayloadBytes
            });


        // ----------------------------------------------------
        // Codex-facing tools
        // ----------------------------------------------------

        this.tools = {

            list:
                new BrowserChatListTool({
                    agentRegistry:
                        this.agentRegistry
                }),

            ask:
                new BrowserChatAskTool({
                    requestManager:
                        this.requestManager,

                    agentRegistry:
                        this.agentRegistry
                }),

            cancel:
                new BrowserChatCancelTool({
                    requestManager:
                        this.requestManager
                })
        };
    }


    // ========================================================
    // Start
    // ========================================================

    async start():
        Promise<void> {

        if (
            this.started
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

        logger.info(
            "Starting Browser Chat module",
            {
                websocketMode:
                    this.websocketServer
                        .getMode(),

                websocketPath:
                    this.websocketServer
                        .getPath()
            }
        );


        /*
         * BridgeManager starts its stale-connection checker.
         */

        this.bridgeManager
            .start();


        try {

            /*
             * standalone:
             *
             *   Starts:
             *   ws://127.0.0.1:20128/browser-bridge
             *
             * attached:
             *
             *   Creates WebSocketServer({ noServer: true }).
             *   The parent HTTP server must forward matching
             *   upgrade requests through handleUpgrade().
             */

            await this.websocketServer
                .start();


            this.started =
                true;


            logger.info(
                "Browser Chat module started",
                {
                    websocketMode:
                        this.websocketServer
                            .getMode(),

                    websocketUrl:
                        this.websocketServer
                            .getUrl(),

                    websocketPath:
                        this.websocketServer
                            .getPath()
                }
            );

        } catch (error) {

            this.bridgeManager
                .stop();


            logger.error(
                "Unable to start Browser Chat module",
                error
            );


            throw error;
        }
    }


    // ========================================================
    // Attached WebSocket integration
    // ========================================================

    /*
     * Returns true when this HTTP upgrade request belongs to
     * Browser Chat.
     *
     * Host applications can use this before forwarding
     * the socket to handleUpgrade().
     */

    isUpgradeRequest(
        request:
            IncomingMessage
    ): boolean {

        return this.websocketServer
            .isUpgradeRequest(
                request
            );
    }


    /*
     * Handle an HTTP -> WebSocket upgrade supplied by an
     * existing HTTP server.
     *
     * This is intended for:
     *
     *   Host HTTP server
     *       ↓
     *   /browser-bridge
     *       ↓
     *   Browser Chat
     *
     * Returns true when Browser Chat accepted/handled the
     * upgrade request.
     */

    handleUpgrade(
        request:
            IncomingMessage,

        socket:
            Duplex,

        head:
            Buffer
    ): boolean {

        if (
            !this.started
        ) {

            logger.warn(
                "Browser Chat upgrade received before module start",
                {
                    path:
                        request.url
                }
            );


            return false;
        }


        return this.websocketServer
            .handleUpgrade(
                request,
                socket,
                head
            );
    }


    // ========================================================
    // Stop
    // ========================================================

    async stop():
        Promise<void> {

        if (
            this.stopping
        ) {

            return this.stopping;
        }


        this.stopping =
            this.stopInternal();


        try {

            await this.stopping;

        } finally {

            this.stopping =
                null;
        }
    }


    private async stopInternal():
        Promise<void> {

        if (
            !this.started &&
            !this.websocketServer
                .isRunning()
        ) {

            return;
        }


        logger.info(
            "Stopping Browser Chat module"
        );


        /*
         * Stop accepting browser connections first.
         */

        await this.websocketServer
            .stop();


        /*
         * Then stop bridge stale monitoring.
         */

        this.bridgeManager
            .stop();


        /*
         * Clear queue.
         */

        this.requestQueue
            .clear();


        this.started =
            false;


        logger.info(
            "Browser Chat module stopped"
        );
    }


    // ========================================================
    // State
    // ========================================================

    isStarted():
        boolean {

        return this.started;
    }


    getWebSocketMode():
        BrowserChatWebSocketMode {

        return this.websocketServer
            .getMode();
    }


    getWebSocketUrl():
        string {

        return this.websocketServer
            .getUrl();
    }


    getWebSocketPath():
        string {

        return this.websocketServer
            .getPath();
    }


    // ========================================================
    // Generic tool executor
    // ========================================================

    /*
     * This gives host applications a simple integration point even if their
     * existing tool registry has a different API.
     */

    async executeTool(
        name: string,
        input:
            unknown = {}
    ): Promise<unknown> {

        switch (name) {

            case "browser_chat_list":

                return this.tools
                    .list
                    .execute();


            case "browser_chat_ask":

                return this.tools
                    .ask
                    .execute(
                        input as Parameters<
                            BrowserChatAskTool["execute"]
                        >[0]
                    );


            case "browser_chat_cancel":

                return this.tools
                    .cancel
                    .execute(
                        input as Parameters<
                            BrowserChatCancelTool["execute"]
                        >[0]
                    );


            default:

                throw new Error(
                    `Unknown Browser Chat tool: ${name}`
                );
        }
    }


    // ========================================================
    // Status
    // ========================================================

    getStatus() {

        return {

            started:
                this.started,

            websocket: {

                mode:
                    this.websocketServer
                        .getMode(),

                url:
                    this.websocketServer
                        .getUrl(),

                path:
                    this.websocketServer
                        .getPath(),

                running:
                    this.websocketServer
                        .isRunning(),

                connections:
                    this.websocketServer
                        .getConnectionCount()
            },

            bridges:
                this.bridgeManager
                    .listBridges(),

            agents:
                this.agentRegistry
                    .list(),

            requests: {

                active:
                    this.requestManager
                        .count(),

                queued:
                    this.requestQueue
                        .size()
            }
        };
    }
}


// ============================================================
// Factory
// ============================================================

export function createBrowserChatModule(
    options:
        BrowserChatModuleOptions = {}
): BrowserChatModule {

    return new BrowserChatModule(
        options
    );
}


// ============================================================
// Singleton helper
// ============================================================

let defaultInstance:
    BrowserChatModule | null =
    null;


/*
 * Optional convenience helper for host integrations.
 *
 * Do not automatically start the module during import.
 */

export function getBrowserChatModule(
    options?:
        BrowserChatModuleOptions
): BrowserChatModule {

    if (
        !defaultInstance
    ) {

        defaultInstance =
            createBrowserChatModule(
                options
            );
    }


    return defaultInstance;
}


// ============================================================
// Start default instance
// ============================================================

export async function startBrowserChat(
    options?:
        BrowserChatModuleOptions
): Promise<
    BrowserChatModule
> {

    const instance =
        getBrowserChatModule(
            options
        );


    try {

        await instance.start();


        return instance;

    } catch (error) {

        logger.error(
            "startBrowserChat failed",
            error,
            {
                error:
                    getErrorMessage(
                        error
                    )
            }
        );


        throw error;
    }
}


// ============================================================
// Stop default instance
// ============================================================

export async function stopBrowserChat():
    Promise<void> {

    if (
        !defaultInstance
    ) {
        return;
    }


    const instance =
        defaultInstance;


    defaultInstance =
        null;


    await instance.stop();
}


// ============================================================
// Re-exports
// ============================================================

export {
    AgentRegistry
} from "./agent-registry";

export {
    BridgeManager
} from "./bridge-manager";

export {
    RequestManager,
    BrowserChatRequestError
} from "./request-manager";

export {
    RequestQueue,
    RequestQueueError
} from "./request-queue";

export {
    BrowserChatWebSocketServer
} from "./websocket-server";

export type {
    BrowserChatWebSocketMode
} from "./websocket-server";


export {
    BrowserChatListTool,
    browserChatList,
    browserChatListToolDefinition
} from "./tools/browser-chat-list";

export {
    BrowserChatAskTool,
    browserChatAsk,
    browserChatAskToolDefinition
} from "./tools/browser-chat-ask";

export {
    BrowserChatCancelTool,
    browserChatCancel,
    browserChatCancelToolDefinition
} from "./tools/browser-chat-cancel";


// ============================================================
// OpenAI-compatible provider
// ============================================================

export {
    BrowserChatOpenAIAdapter,
    createBrowserChatOpenAIAdapter
} from "./openai/adapter";

export type {
    BrowserChatOpenAIAdapterDependencies,
    BrowserChatOpenAIAdapterOptions,
    OpenAIChatMessage,
    OpenAIChatCompletionRequest,
    OpenAIChatCompletionResponse,
    OpenAIModel,
    OpenAIModelList
} from "./openai/adapter";


export {
    BrowserChatOpenAIHttpHandler,
    createBrowserChatOpenAIHttpHandler,

    BROWSER_CHAT_OPENAI_BASE_PATH,
    BROWSER_CHAT_OPENAI_MODELS_PATH,
    BROWSER_CHAT_OPENAI_CHAT_COMPLETIONS_PATH
} from "./openai/http-handler";

export type {
    BrowserChatOpenAIHttpHandlerOptions,
    OpenAIErrorResponse
} from "./openai/http-handler";


export * from "./protocol/types";
export * from "./protocol/messages";
export * from "./protocol/validator";

export {
    PROTOCOL_VERSION,
    BROWSER_CHAT_SERVER_VERSION,

    DEFAULT_BRIDGE_ID,

    DEFAULT_WS_HOST,
    DEFAULT_WS_PORT,
    DEFAULT_WS_PATH,
    DEFAULT_WS_URL,

    MESSAGE_TYPE,
    METHOD,

    BRIDGE_STATUS,
    AGENT_STATUS,
    REQUEST_STATUS,

    PROVIDER,
    CAPABILITY,

    DEFAULT_REQUEST_TIMEOUT_MS,
    MIN_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS,

    DEFAULT_HEARTBEAT_INTERVAL_MS,
    BRIDGE_STALE_TIMEOUT_MS,

    DEFAULT_REQUEST_QUEUE_SIZE,

    ERROR_CODE,

    WS_READY_STATE,
    WS_CLOSE_CODE,

    DEFAULT_CONFIG
} from "./protocol/constants";

