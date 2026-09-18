// src/background/service-worker.js

import {
    DEFAULT_CONFIG,
    DEFAULT_BRIDGE_ID,
    BRIDGE_VERSION,
    BRIDGE_STATUS,
    CAPABILITY,
    INTERNAL_MESSAGE,
    PROVIDER,
    AGENT_STATUS,
    STORAGE_KEY
} from "../protocol/constants.js";

import {
    createBridgeRegister,
    createAgentRegister,
    createAgentUnregister,
    createAgentStatus
} from "../protocol/messages.js";

import {
    WebSocketManager
} from "./websocket.js";

import {
    AgentRegistry
} from "./agent-registry.js";

import {
    RequestRouter
} from "./request-router.js";

import {
    HeartbeatManager
} from "./heartbeat.js";


// ============================================================
// Runtime state
// ============================================================

let initialized = false;

let initializationPromise = null;

let bridgeStatus =
    BRIDGE_STATUS.DISCONNECTED;

let bridgeId =
    DEFAULT_BRIDGE_ID;

let wsUrl =
    DEFAULT_CONFIG.wsUrl;

let heartbeatInterval =
    DEFAULT_CONFIG.heartbeatInterval;

let pendingBridgeRegisterId =
    null;


async function loadElectronRuntimeConfig() {

    try {

        const response =
            await fetch(
                chrome.runtime.getURL(
                    "electron/runtime-config.json"
                ),
                {
                    cache:
                        "no-store"
                }
            );

        if (!response.ok) {
            return {};
        }

        const config =
            await response.json();

        if (
            !config ||
            typeof config !== "object"
        ) {
            return {};
        }

        return config;

    } catch {
        return {};
    }
}


// ============================================================
// Core components
// ============================================================

const agentRegistry =
    new AgentRegistry();


const websocket =
    new WebSocketManager({

        url: wsUrl,

        onOpen: () => {
            handleWebSocketOpen();
        },

        onClose: () => {
            handleWebSocketClose();
        },

        onMessage: (message) => {
            handleWebSocketMessage(message);
        },

        onError: (error) => {
            console.error(
                "[ServiceWorker] WebSocket error:",
                error
            );
        },

        onStateChange: (state) => {
            console.log(
                "[ServiceWorker] WebSocket state:",
                state
            );
        }
    });


const heartbeat =
    new HeartbeatManager({

        bridgeId,

        intervalMs:
            heartbeatInterval,

        send: (message) =>
            websocket.send(message)
    });


const requestRouter =
    new RequestRouter({

        agentRegistry,

        sendToProviderHost: (message) =>
            websocket.send(message)
    });


// ============================================================
// Initialization
// ============================================================

async function initialize() {

    if (initialized) {
        return;
    }

    if (initializationPromise) {
        return initializationPromise;
    }


    initializationPromise =
        (async () => {

            console.log(
                "[ServiceWorker] Initializing Browser Chat Bridge..."
            );


            // ------------------------------------------------------
            // Load configuration
            // ------------------------------------------------------

            const stored =
                await chrome.storage.local.get([
                    STORAGE_KEY.WS_URL,
                    STORAGE_KEY.BRIDGE_ID
                ]);


            const runtimeConfig =
                await loadElectronRuntimeConfig();


            wsUrl =
                runtimeConfig.wsUrl ||
                stored[STORAGE_KEY.WS_URL] ||
                DEFAULT_CONFIG.wsUrl;


            bridgeId =
                stored[STORAGE_KEY.BRIDGE_ID] ||
                DEFAULT_BRIDGE_ID;


            websocket.setUrl(
                wsUrl
            );


            heartbeat.setBridgeId(
                bridgeId
            );


            // ------------------------------------------------------
            // Restore agents
            // ------------------------------------------------------

            await agentRegistry.initialize();

            await agentRegistry.validateTabs();


            initialized = true;


            console.log(
                "[ServiceWorker] Initialized",
                {
                    bridgeId,
                    wsUrl,
                    agents:
                        agentRegistry.list().length
                }
            );


            // ------------------------------------------------------
            // Connect to Browser Chat Provider
            // ------------------------------------------------------

            websocket.connect();

        })()
            .catch((error) => {

                console.error(
                    "[ServiceWorker] Initialization failed:",
                    error
                );

                initializationPromise =
                    null;

                throw error;
            });


    return initializationPromise;
}


// ============================================================
// WebSocket lifecycle
// ============================================================

function handleWebSocketOpen() {

    bridgeStatus =
        BRIDGE_STATUS.REGISTERING;


    heartbeat.stop();


    console.log(
        "[ServiceWorker] Registering bridge:",
        bridgeId
    );


    const registration =
        createBridgeRegister({
            bridgeId,

            name:
                "Chrome Desktop",

            bridgeVersion:
                BRIDGE_VERSION,

            capabilities: [
                CAPABILITY.TEXT,
                CAPABILITY.STREAM,
                CAPABILITY.CANCEL,
                CAPABILITY.TAB_DISCOVERY
            ]
        });


    pendingBridgeRegisterId =
        registration.id;


    websocket.send(
        registration
    );
}


function handleWebSocketClose() {

    bridgeStatus =
        BRIDGE_STATUS.DISCONNECTED;


    pendingBridgeRegisterId =
        null;


    heartbeat.stop();


    console.log(
        "[ServiceWorker] Browser Chat Provider disconnected"
    );
}


// ============================================================
// Incoming WebSocket messages
// ============================================================

async function handleWebSocketMessage(
    message
) {

    try {

        // --------------------------------------------------------
        // bridge.register response
        // --------------------------------------------------------

        if (
            pendingBridgeRegisterId &&
            message.type === "response" &&
            message.id ===
            pendingBridgeRegisterId
        ) {

            const accepted =
                message.result?.accepted !== false;


            if (!accepted) {

                bridgeStatus =
                    BRIDGE_STATUS.ERROR;


                console.error(
                    "[ServiceWorker] Bridge registration rejected:",
                    message.result
                );


                return;
            }


            pendingBridgeRegisterId =
                null;


            bridgeStatus =
                BRIDGE_STATUS.READY;


            const remoteHeartbeatInterval =
                message.result?.heartbeatInterval;


            if (
                Number.isFinite(
                    remoteHeartbeatInterval
                ) &&
                remoteHeartbeatInterval >= 1000
            ) {

                heartbeatInterval =
                    remoteHeartbeatInterval;


                heartbeat.setIntervalMs(
                    remoteHeartbeatInterval
                );
            }


            heartbeat.start();


            console.log(
                "[ServiceWorker] Bridge ready:",
                bridgeId
            );


            /*
             * Re-register all browser agents.
             *
             * Important after:
             * - WebSocket reconnect
             * - Browser Chat Provider restart
             * - service worker restart
             */
            await announceAllAgents();


            return;
        }


        // --------------------------------------------------------
        // bridge.register error
        // --------------------------------------------------------

        if (
            pendingBridgeRegisterId &&
            message.type === "error" &&
            message.id ===
            pendingBridgeRegisterId
        ) {

            bridgeStatus =
                BRIDGE_STATUS.ERROR;


            pendingBridgeRegisterId =
                null;


            heartbeat.stop();


            console.error(
                "[ServiceWorker] Bridge registration error:",
                message.error
            );


            return;
        }


        // --------------------------------------------------------
        // Normal protocol message
        // --------------------------------------------------------

        await requestRouter.handle(
            message
        );

    } catch (error) {

        const messageText =
            error instanceof Error
                ? error.message
                : String(error || "Unknown error");


        if (messageText === "No SW") {

            console.warn(
                "[ServiceWorker] Content script/service worker channel unavailable. Reload the ChatGPT window and reopen the bridge popup."
            );

            return;
        }

        console.error(
            "[ServiceWorker] Failed to process WebSocket message:",
            error
        );
    }
}


// ============================================================
// Agent announcement
// ============================================================

async function announceAllAgents() {

    const agents =
        agentRegistry.list();


    const refreshed = [];


    for (const agent of agents) {

        /*
         * Verify that the tab still exists.
         */
        let tabExists =
            false;


        try {

            await chrome.tabs.get(
                agent.tabId
            );

            tabExists =
                true;

        } catch {
            tabExists =
                false;
        }


        if (!tabExists) {

            const offlineAgent =
                await agentRegistry.setStatus(
                agent.agentId,
                AGENT_STATUS.OFFLINE
            );


            refreshed.push(
                offlineAgent
            );

            continue;
        }


        const announcedAgent =
            agent.status === AGENT_STATUS.OFFLINE
                ? await agentRegistry.setStatus(
                    agent.agentId,
                    AGENT_STATUS.IDLE
                )
                : agent;


        refreshed.push(
            announcedAgent
        );


        /*
         * A tab existing does not necessarily mean the content
         * script is ready. We announce the stored state first;
         * content script will later report PROVIDER_DETECTED.
         */

        websocket.send(
            createAgentRegister({
                bridgeId,
                agentId:
                    announcedAgent.agentId,

                provider:
                    announcedAgent.provider,

                tabId:
                    announcedAgent.tabId,

                conversationId:
                    announcedAgent.conversationId,

                title:
                    announcedAgent.title,

                status:
                    announcedAgent.status,

                capabilities:
                    announcedAgent.capabilities
            })
        );
    }


    return refreshed;
}


// ============================================================
// Messages from Content Scripts / Popup
// ============================================================

chrome.runtime.onMessage.addListener(
    (
        message,
        sender,
        sendResponse
    ) => {

        /*
         * Chrome does not await async listeners reliably when
         * returning a Promise in every supported MV3 scenario.
         *
         * Use an async IIFE and return true to keep the response
         * channel open.
         */

        (async () => {

            try {

                await initialize();


                const result =
                    await handleRuntimeMessage(
                        message,
                        sender
                    );


                sendResponse({
                    ok: true,
                    ...result
                });

            } catch (error) {

                console.error(
                    "[ServiceWorker] Runtime message failed:",
                    error
                );


                sendResponse({
                    ok: false,

                    error:
                        error?.message ||
                        String(error)
                });
            }

        })();


        return true;
    }
);
// ============================================================
// Chrome DevTools Protocol input test
// ============================================================

async function insertTextWithCDP(
    tabId,
    text
) {

    if (
        !chrome.debugger ||
        typeof chrome.debugger.attach !== "function"
    ) {
        throw new Error(
            "chrome.debugger unavailable"
        );
    }

    if (!Number.isInteger(tabId)) {
        throw new Error(
            "CDP input requires a valid tabId"
        );
    }


    if (
        typeof text !== "string" ||
        !text
    ) {
        throw new Error(
            "CDP input requires non-empty text"
        );
    }


    const target = {
        tabId
    };


    let attached =
        false;


    try {

        // --------------------------------------------------------
        // Attach debugger
        // --------------------------------------------------------

        await chrome.debugger.attach(
            target,
            "1.3"
        );

        attached =
            true;


        console.log(
            "[ServiceWorker][CDP] Attached",
            {
                tabId
            }
        );


        // --------------------------------------------------------
        // Focus ChatGPT ProseMirror in page context
        // --------------------------------------------------------

        const focusResult =
            await chrome.debugger.sendCommand(
                target,
                "Runtime.evaluate",
                {
                    expression: `
(() => {
    const composer =
        document.querySelector(
            'div.ProseMirror[contenteditable="true"]'
        );

    if (!composer) {
        return {
            ok: false,
            error: "composer-not-found"
        };
    }

    composer.focus();

    const selection =
        window.getSelection();

    const range =
        document.createRange();

    range.selectNodeContents(
        composer
    );

    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);

    return {
        ok: true,
        tagName: composer.tagName,
        className: composer.className
    };
})()
                    `,
                    returnByValue: true
                }
            );


        const focusValue =
            focusResult?.result?.value;


        console.log(
            "[ServiceWorker][CDP] Focus result",
            focusValue
        );


        if (!focusValue?.ok) {
            throw new Error(
                focusValue?.error ||
                "Unable to focus ChatGPT composer"
            );
        }


        // --------------------------------------------------------
        // Browser-level text insertion
        // --------------------------------------------------------

        await chrome.debugger.sendCommand(
            target,
            "Input.insertText",
            {
                text
            }
        );


        console.log(
            "[ServiceWorker][CDP] Text inserted",
            {
                tabId,
                length: text.length
            }
        );


        // --------------------------------------------------------
        // Verify resulting DOM
        // --------------------------------------------------------

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    150
                )
        );


        const verifyResult =
            await chrome.debugger.sendCommand(
                target,
                "Runtime.evaluate",
                {
                    expression: `
(() => {
    const composer =
        document.querySelector(
            'div.ProseMirror[contenteditable="true"]'
        );

    const sendButton =
        document.querySelector(
            'button[type="submit"]'
        );

    return {
        composerFound: !!composer,

        text:
            composer
                ? (
                    composer.innerText ||
                    composer.textContent ||
                    ""
                  )
                : "",

        sendButtonFound:
            !!sendButton,

        sendButtonLabel:
            sendButton
                ?.getAttribute("aria-label") ||
                null
    };
})()
                    `,
                    returnByValue: true
                }
            );


        const result =
            verifyResult?.result?.value ||
            {};


        console.log(
            "[ServiceWorker][CDP] Verify",
            {
                composerFound:
                    result.composerFound,

                textLength:
                    typeof result.text ===
                        "string"
                        ? result.text.length
                        : 0,

                sendButtonFound:
                    result.sendButtonFound,

                sendButtonLabel:
                    result.sendButtonLabel
            }
        );


        return result;

    } finally {

        if (attached) {

            try {

                await chrome.debugger.detach(
                    target
                );


                console.log(
                    "[ServiceWorker][CDP] Detached",
                    {
                        tabId
                    }
                );

            } catch (error) {

                console.warn(
                    "[ServiceWorker][CDP] Detach failed",
                    error
                );
            }
        }
    }
}

// ============================================================
// Runtime message router
// ============================================================

async function handleRuntimeMessage(
    message,
    sender
) {

    if (
        !message ||
        typeof message !== "object"
    ) {

        throw new Error(
            "Invalid runtime message"
        );
    }


    switch (message.type) {

        // --------------------------------------------------------
        // Popup: bridge status
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.GET_BRIDGE_STATUS:

            return {
                bridge: {
                    bridgeId,
                    wsUrl,
                    status:
                        bridgeStatus,

                    connected:
                        websocket.isConnected(),

                    heartbeat:
                        heartbeat.getStatus()
                }
            };


        // --------------------------------------------------------
        // Popup: current agent
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.GET_CURRENT_AGENT: {

            const tabId =
                message.tabId ??
                sender.tab?.id;


            if (!Number.isInteger(tabId)) {

                return {
                    agent: null
                };
            }


            return {
                agent:
                    agentRegistry.getByTabId(
                        tabId
                    )
            };
        }

        case INTERNAL_MESSAGE.GET_AGENTS:
            return await handleGetAgents();
        // --------------------------------------------------------
        // Popup: register agent
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.REGISTER_AGENT:

            return await handleRegisterAgent(
                message
            );


        // --------------------------------------------------------
        // Popup: unregister agent
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.UNREGISTER_AGENT:

            return await handleUnregisterAgent(
                message
            );


        // --------------------------------------------------------
        // Content: provider detected
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.PROVIDER_DETECTED:

            return await handleProviderDetected(
                message,
                sender
            );


        // --------------------------------------------------------
        // Content: CDP composer input
        // --------------------------------------------------------

        case "browser-chat.cdp-input": {

            const tabId =
                sender.tab?.id;


            if (!Number.isInteger(tabId)) {

                throw new Error(
                    "CDP input requires sender tabId"
                );
            }


            if (
                typeof message.text !== "string" ||
                !message.text
            ) {

                throw new Error(
                    "CDP input requires non-empty text"
                );
            }


            if (
                !chrome.debugger ||
                typeof chrome.debugger.attach !== "function"
            ) {
                return {
                    ok: false,
                    error:
                        "chrome.debugger unavailable"
                };
            }


            const result =
                await insertTextWithCDP(
                    tabId,
                    message.text
                );


            return {
                ok: true,
                result
            };
        }


        // --------------------------------------------------------
        // Content: chat started
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.CHAT_STARTED:

            await requestRouter.handleChatStarted({
                requestId:
                    message.requestId,

                agentId:
                    message.agentId
            });

            return {};


        // --------------------------------------------------------
        // Content: streaming delta
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.CHAT_DELTA:

            requestRouter.handleChatDelta({
                requestId:
                    message.requestId,

                agentId:
                    message.agentId,

                seq:
                    message.seq,

                delta:
                    message.delta
            });

            return {};


        // --------------------------------------------------------
        // Content: completed
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.CHAT_COMPLETED:

            await requestRouter.handleChatCompleted({
                requestId:
                    message.requestId,

                agentId:
                    message.agentId,

                content:
                    message.content,

                conversationId:
                    message.conversationId ??
                    null,

                durationMs:
                    message.durationMs ??
                    null
            });

            return {};


        // --------------------------------------------------------
        // Content: error
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.CHAT_ERROR:

            await requestRouter.handleChatError({
                requestId:
                    message.requestId,

                agentId:
                    message.agentId,

                error:
                    message.error
            });

            return {};


        // --------------------------------------------------------
        // Content: provider status
        // --------------------------------------------------------

        case INTERNAL_MESSAGE.PROVIDER_STATUS:

            return await handleProviderStatus(
                message,
                sender
            );

        case "browser-chat.cdp-test": {

            const tabId =
                message.tabId ??
                sender.tab?.id;


            if (
                !chrome.debugger ||
                typeof chrome.debugger.attach !== "function"
            ) {
                return {
                    ok: false,
                    error:
                        "chrome.debugger unavailable"
                };
            }


            const result =
                await insertTextWithCDP(
                    tabId,
                    message.text || "CDP_TEST"
                );


            return {
                result
            };
        }
        default:

            throw new Error(
                `Unsupported runtime message: ${message.type}`
            );
    }
}
async function handleGetAgents() {

    if (
        bridgeStatus ===
        BRIDGE_STATUS.READY
    ) {
        const agents =
            await announceAllAgents();

        return {
            agents
        };
    }

    return {
        agents:
            agentRegistry.list()
    };
}

// ============================================================
// Register Agent
// ============================================================

async function handleRegisterAgent(
    message
) {

    const agentId =
        message.agentId?.trim();

    const tabId =
        message.tabId;


    if (!agentId) {

        throw new Error(
            "agentId is required"
        );
    }


    if (!Number.isInteger(tabId)) {

        throw new Error(
            "tabId is required"
        );
    }


    // ----------------------------------------------------------
    // Verify tab
    // ----------------------------------------------------------

    const tab =
        await chrome.tabs.get(
            tabId
        );


    if (!tab) {

        throw new Error(
            `Tab not found: ${tabId}`
        );
    }


    // ----------------------------------------------------------
    // Only ChatGPT for MVP
    // ----------------------------------------------------------

    if (
        !tab.url ||
        !tab.url.startsWith(
            "https://chatgpt.com/"
        )
    ) {

        throw new Error(
            "Current tab is not a supported ChatGPT page"
        );
    }


    // ----------------------------------------------------------
    // Ask content script for provider information
    // ----------------------------------------------------------

    let providerInfo = {};


    try {

        providerInfo =
            await chrome.tabs.sendMessage(
                tabId,
                {
                    type:
                        INTERNAL_MESSAGE.PROVIDER_STATUS
                }
            ) || {};

    } catch (error) {

        console.warn(
            "[ServiceWorker] Unable to query content script:",
            error
        );
    }


    const agent =
        await agentRegistry.register({
            agentId,

            provider:
                PROVIDER.CHATGPT,

            tabId,

            conversationId:
                providerInfo.conversationId ??
                null,

            title:
                providerInfo.title ??
                tab.title ??
                null,

            status:
                AGENT_STATUS.IDLE,

            capabilities: [
                CAPABILITY.TEXT,
                CAPABILITY.STREAM,
                CAPABILITY.CANCEL
            ]
        });


    // ----------------------------------------------------------
    // Notify Browser Chat Provider
    // ----------------------------------------------------------

    if (
        bridgeStatus ===
        BRIDGE_STATUS.READY
    ) {

        websocket.send(
            createAgentRegister({
                bridgeId,
                agentId:
                    agent.agentId,

                provider:
                    agent.provider,

                tabId:
                    agent.tabId,

                conversationId:
                    agent.conversationId,

                title:
                    agent.title,

                status:
                    agent.status,

                capabilities:
                    agent.capabilities
            })
        );
    }


    console.log(
        "[ServiceWorker] Agent registered:",
        agentId
    );


    return {
        agent
    };
}


// ============================================================
// Unregister Agent
// ============================================================

async function handleUnregisterAgent(
    message
) {

    const agentId =
        message.agentId;


    if (!agentId) {

        throw new Error(
            "agentId is required"
        );
    }


    const existing =
        agentRegistry.get(
            agentId
        );


    if (!existing) {

        return {
            removed: false
        };
    }


    await agentRegistry.unregister(
        agentId
    );


    if (
        bridgeStatus ===
        BRIDGE_STATUS.READY
    ) {

        websocket.send(
            createAgentUnregister(
                bridgeId,
                agentId
            )
        );
    }


    return {
        removed: true
    };
}


// ============================================================
// Provider detected
// ============================================================

async function handleProviderDetected(
    message,
    sender
) {

    const tabId =
        sender.tab?.id;


    if (!Number.isInteger(tabId)) {

        return {
            registered: false
        };
    }


    /*
     * Provider detection does NOT automatically create an agent.
     *
     * The user explicitly assigns an agent name through popup.
     */

    const agent =
        agentRegistry.getByTabId(
            tabId
        );


    if (!agent) {

        return {
            registered: false
        };
    }


    const updated =
        await agentRegistry.update(
            agent.agentId,
            {
                provider:
                    message.provider ||
                    agent.provider,

                conversationId:
                    message.conversationId ??
                    agent.conversationId,

                title:
                    message.title ??
                    agent.title,

                status:
                    AGENT_STATUS.IDLE
            }
        );


    if (
        bridgeStatus ===
        BRIDGE_STATUS.READY
    ) {

        websocket.send(
            createAgentRegister({
                bridgeId,
                agentId:
                    updated.agentId,

                provider:
                    updated.provider,

                tabId:
                    updated.tabId,

                conversationId:
                    updated.conversationId,

                title:
                    updated.title,

                status:
                    updated.status,

                capabilities:
                    updated.capabilities
            })
        );
    }


    return {
        registered: true,
        agent: updated
    };
}


// ============================================================
// Provider status
// ============================================================

async function handleProviderStatus(
    message,
    sender
) {

    const tabId =
        sender.tab?.id;


    if (!Number.isInteger(tabId)) {
        return {};
    }


    const agent =
        agentRegistry.getByTabId(
            tabId
        );


    if (!agent) {
        return {};
    }


    const changes = {};


    if (
        message.conversationId !==
        undefined
    ) {

        changes.conversationId =
            message.conversationId;
    }


    if (
        message.title !==
        undefined
    ) {

        changes.title =
            message.title;
    }


    if (
        message.status &&
        !agent.activeRequestId
    ) {

        changes.status =
            message.status;
    }


    if (
        Object.keys(changes).length > 0
    ) {

        await agentRegistry.update(
            agent.agentId,
            changes
        );
    }


    return {};
}


// ============================================================
// Tab lifecycle
// ============================================================

chrome.tabs.onRemoved.addListener(
    (tabId) => {

        (async () => {

            try {

                await initialize();


                const removed =
                    await agentRegistry.removeByTabId(
                        tabId
                    );


                if (
                    bridgeStatus !==
                    BRIDGE_STATUS.READY
                ) {
                    return;
                }


                for (const agent of removed) {

                    websocket.send(
                        createAgentUnregister(
                            bridgeId,
                            agent.agentId
                        )
                    );
                }

            } catch (error) {

                console.error(
                    "[ServiceWorker] tab removal handler failed:",
                    error
                );
            }

        })();
    }
);


// ============================================================
// Tab updated / navigation
// ============================================================

chrome.tabs.onUpdated.addListener(
    (
        tabId,
        changeInfo,
        tab
    ) => {

        if (
            changeInfo.status !==
            "complete"
        ) {
            return;
        }


        (async () => {

            try {

                await initialize();


                const agent =
                    agentRegistry.getByTabId(
                        tabId
                    );


                if (!agent) {
                    return;
                }


                // ----------------------------------------------------
                // Tab navigated away from ChatGPT
                // ----------------------------------------------------

                if (
                    !tab.url ||
                    !tab.url.startsWith(
                        "https://chatgpt.com/"
                    )
                ) {

                    await agentRegistry.setStatus(
                        agent.agentId,
                        AGENT_STATUS.OFFLINE
                    );


                    if (
                        bridgeStatus ===
                        BRIDGE_STATUS.READY
                    ) {

                        websocket.send(
                            createAgentStatus(
                                agent.agentId,
                                AGENT_STATUS.OFFLINE
                            )
                        );
                    }


                    return;
                }


                /*
                 * Content script will report PROVIDER_DETECTED once
                 * the ChatGPT page becomes ready.
                 */

            } catch (error) {

                console.error(
                    "[ServiceWorker] tab update handler failed:",
                    error
                );
            }

        })();
    }
);


// ============================================================
// Extension lifecycle
// ============================================================

chrome.runtime.onInstalled.addListener(
    () => {

        console.log(
            "[ServiceWorker] Extension installed/updated"
        );


        initialize().catch(
            console.error
        );
    }
);


chrome.runtime.onStartup.addListener(
    () => {

        console.log(
            "[ServiceWorker] Chrome startup"
        );


        initialize().catch(
            console.error
        );
    }
);


// ============================================================
// Storage changes
// ============================================================

chrome.storage.onChanged.addListener(
    (
        changes,
        areaName
    ) => {

        if (areaName !== "local") {
            return;
        }


        // --------------------------------------------------------
        // WebSocket URL changed
        // --------------------------------------------------------

        if (
            changes[STORAGE_KEY.WS_URL]
        ) {

            const newUrl =
                changes[
                    STORAGE_KEY.WS_URL
                ].newValue;


            if (
                typeof newUrl === "string" &&
                newUrl.trim()
            ) {

                wsUrl =
                    newUrl.trim();


                websocket.setUrl(
                    wsUrl
                );
            }
        }


        // --------------------------------------------------------
        // Bridge ID changed
        // --------------------------------------------------------

        if (
            changes[STORAGE_KEY.BRIDGE_ID]
        ) {

            const newBridgeId =
                changes[
                    STORAGE_KEY.BRIDGE_ID
                ].newValue;


            if (
                typeof newBridgeId === "string" &&
                newBridgeId.trim()
            ) {

                bridgeId =
                    newBridgeId.trim();


                heartbeat.setBridgeId(
                    bridgeId
                );
            }
        }
    }
);


// ============================================================
// Bootstrap
// ============================================================

initialize().catch(
    (error) => {

        console.error(
            "[ServiceWorker] Bootstrap failed:",
            error
        );
    }
);
