// src/popup/popup.js

import {
    INTERNAL_MESSAGE,
    BRIDGE_STATUS,
    AGENT_STATUS,
    DEFAULT_WS_URL
} from "../protocol/constants.js";


// ============================================================
// DOM
// ============================================================

const elements = {
    bridgeStatus:
        document.getElementById("bridge-status"),

    bridgeStatusText:
        document.getElementById("bridge-status-text"),

    providerName:
        document.getElementById("provider-name"),

    conversationTitle:
        document.getElementById("conversation-title"),

    providerStatus:
        document.getElementById("provider-status"),

    unsupportedMessage:
        document.getElementById("unsupported-message"),

    agentForm:
        document.getElementById("agent-form"),

    agentId:
        document.getElementById("agent-id"),

    registerButton:
        document.getElementById("register-button"),

    registeredPanel:
        document.getElementById("registered-panel"),

    registeredAgentId:
        document.getElementById("registered-agent-id"),

    unregisterButton:
        document.getElementById("unregister-button"),

    refreshButton:
        document.getElementById("refresh-button"),

    agentsEmpty:
        document.getElementById("agents-empty"),

    agentsList:
        document.getElementById("agents-list"),

    wsUrl:
        document.getElementById("ws-url"),

    connectionState:
        document.getElementById("connection-state"),

    errorMessage:
        document.getElementById("error-message")
};


// ============================================================
// State
// ============================================================

let activeTab =
    null;

let providerInfo =
    null;

let currentAgent =
    null;

let bridgeInfo =
    null;

let agents =
    [];

let busy =
    false;


// ============================================================
// Bootstrap
// ============================================================

async function initialize() {

    bindEvents();


    setBusy(true);

    clearError();


    try {

        await refreshAll();

    } catch (error) {

        showError(
            error?.message ||
            String(error)
        );

    } finally {

        setBusy(false);
    }
}


// ============================================================
// Events
// ============================================================

function bindEvents() {

    elements.agentForm.addEventListener(
        "submit",
        handleRegister
    );


    elements.unregisterButton.addEventListener(
        "click",
        handleUnregister
    );


    elements.refreshButton.addEventListener(
        "click",
        handleRefresh
    );


    elements.agentId.addEventListener(
        "input",
        updateRegisterButton
    );
}


// ============================================================
// Refresh
// ============================================================

async function refreshAll() {

    clearError();


    await Promise.all([
        loadBridgeStatus(),
        loadActiveTab(),
        loadAgents()
    ]);


    await loadProviderInfo();


    await loadCurrentAgent();


    render();
}


// ============================================================
// Bridge status
// ============================================================

async function loadBridgeStatus() {

    try {

        bridgeInfo =
            await chrome.runtime.sendMessage({
                type:
                    INTERNAL_MESSAGE.GET_BRIDGE_STATUS
            });


        if (!bridgeInfo) {

            throw new Error(
                "Bridge status unavailable"
            );
        }

    } catch (error) {

        console.debug(
            "[Popup] Bridge status unavailable:",
            error
        );


        bridgeInfo = {
            status:
                BRIDGE_STATUS.DISCONNECTED,

            wsUrl:
                DEFAULT_WS_URL
        };
    }
}


// ============================================================
// Active tab
// ============================================================

async function loadActiveTab() {

    const tabs =
        await chrome.tabs.query({
            active: true,
            currentWindow: true
        });


    activeTab =
        tabs?.[0] ??
        null;
}


// ============================================================
// Provider info
// ============================================================

async function loadProviderInfo() {

    providerInfo =
        null;


    if (!activeTab?.id) {
        return;
    }


    if (
        !isChatGPTUrl(
            activeTab.url
        )
    ) {
        return;
    }


    try {

        const result =
            await chrome.tabs.sendMessage(
                activeTab.id,
                {
                    type:
                        INTERNAL_MESSAGE.PROVIDER_STATUS
                }
            );


        if (result) {
            providerInfo = result;
        }

    } catch (error) {

        /*
         * Most common during development:
         *
         * Extension was reloaded but the ChatGPT tab still contains
         * an old/inactive content-script context.
         */

        console.debug(
            "[Popup] Provider status unavailable:",
            error
        );
    }
}


// ============================================================
// Current registered agent
// ============================================================

async function loadCurrentAgent() {

    currentAgent =
        null;


    if (!activeTab?.id) {
        return;
    }


    try {

        const result =
            await chrome.runtime.sendMessage({
                type:
                    INTERNAL_MESSAGE.GET_CURRENT_AGENT,

                tabId:
                    activeTab.id
            });


        /*
         * Support either:
         *
         * { agent: {...} }
         *
         * or direct agent object.
         */

        currentAgent =
            result?.agent ??
            (
                result?.agentId
                    ? result
                    : null
            );

    } catch (error) {

        console.debug(
            "[Popup] Current agent unavailable:",
            error
        );
    }
}


// ============================================================
// Agent list
// ============================================================

async function loadAgents() {

    agents = [];


    try {

        const result =
            await chrome.runtime.sendMessage({
                type:
                    INTERNAL_MESSAGE.GET_AGENTS
            });


        if (!result?.ok) {

            throw new Error(
                result?.error ||
                "Unable to load agents"
            );
        }


        agents =
            Array.isArray(result.agents)
                ? result.agents
                : [];

    } catch (error) {

        console.debug(
            "[Popup] Agent list unavailable:",
            error
        );
    }
}


// ============================================================
// Register
// ============================================================

async function handleRegister(
    event
) {

    event.preventDefault();


    if (busy) {
        return;
    }


    clearError();


    const agentId =
        elements.agentId
            .value
            .trim();


    if (!isValidAgentId(agentId)) {

        showError(
            "Agent name may contain only letters, numbers, hyphen and underscore."
        );

        return;
    }


    if (!activeTab?.id) {

        showError(
            "Active browser tab not found."
        );

        return;
    }


    if (
        !providerInfo?.detected
    ) {

        showError(
            "ChatGPT is not available in the current tab."
        );

        return;
    }


    setBusy(true);


    try {

        const result =
            await chrome.runtime.sendMessage({
                type:
                    INTERNAL_MESSAGE.REGISTER_AGENT,

                agentId,

                tabId:
                    activeTab.id
            });


        if (
            result?.accepted === false ||
            result?.success === false
        ) {

            throw new Error(
                result.error ||
                "Unable to register agent"
            );
        }


        elements.agentId.value =
            "";


        await refreshAll();

    } catch (error) {

        showError(
            error?.message ||
            String(error)
        );

    } finally {

        setBusy(false);
    }
}


// ============================================================
// Unregister
// ============================================================

async function handleUnregister() {

    if (
        busy ||
        !currentAgent?.agentId
    ) {
        return;
    }


    clearError();


    setBusy(true);


    try {

        const result =
            await chrome.runtime.sendMessage({
                type:
                    INTERNAL_MESSAGE.UNREGISTER_AGENT,

                agentId:
                    currentAgent.agentId
            });


        if (
            result?.accepted === false ||
            result?.success === false
        ) {

            throw new Error(
                result.error ||
                "Unable to unregister agent"
            );
        }


        await refreshAll();

    } catch (error) {

        showError(
            error?.message ||
            String(error)
        );

    } finally {

        setBusy(false);
    }
}


// ============================================================
// Manual refresh
// ============================================================

async function handleRefresh() {

    if (busy) {
        return;
    }


    setBusy(true);


    try {

        await refreshAll();

    } catch (error) {

        showError(
            error?.message ||
            String(error)
        );

    } finally {

        setBusy(false);
    }
}


// ============================================================
// Render
// ============================================================

function render() {

    renderBridge();

    renderCurrentChat();

    renderRegistration();

    renderAgents();

    updateRegisterButton();
}


// ============================================================
// Bridge UI
// ============================================================

function renderBridge() {

    const status =
        bridgeInfo?.status ??
        BRIDGE_STATUS.DISCONNECTED;


    const wsUrl =
        bridgeInfo?.wsUrl ??
        DEFAULT_WS_URL;


    elements.wsUrl.textContent =
        wsUrl;

    elements.wsUrl.title =
        wsUrl;


    const label =
        formatBridgeStatus(
            status
        );


    elements.bridgeStatusText.textContent =
        label;


    elements.bridgeStatus.className =
        "status-badge";


    switch (status) {

        case BRIDGE_STATUS.READY:

            elements.bridgeStatus.classList.add(
                "status-badge--ready"
            );

            break;


        case BRIDGE_STATUS.CONNECTED:

            elements.bridgeStatus.classList.add(
                "status-badge--connected"
            );

            break;


        case BRIDGE_STATUS.CONNECTING:

        case BRIDGE_STATUS.REGISTERING:

            elements.bridgeStatus.classList.add(
                "status-badge--connecting"
            );

            break;


        case BRIDGE_STATUS.ERROR:

            elements.bridgeStatus.classList.add(
                "status-badge--error"
            );

            break;


        default:

            elements.bridgeStatus.classList.add(
                "status-badge--offline"
            );
    }


    elements.connectionState.className =
        "connection__state";


    if (
        status === BRIDGE_STATUS.READY ||
        status === BRIDGE_STATUS.CONNECTED
    ) {

        elements.connectionState.textContent =
            "Connected";

        elements.connectionState.classList.add(
            "connection__state--connected"
        );

    } else if (
        status === BRIDGE_STATUS.CONNECTING ||
        status === BRIDGE_STATUS.REGISTERING
    ) {

        elements.connectionState.textContent =
            "Connecting";

        elements.connectionState.classList.add(
            "connection__state--connecting"
        );

    } else if (
        status === BRIDGE_STATUS.ERROR
    ) {

        elements.connectionState.textContent =
            "Error";

        elements.connectionState.classList.add(
            "connection__state--error"
        );

    } else {

        elements.connectionState.textContent =
            "Disconnected";
    }
}


// ============================================================
// Current chat UI
// ============================================================

function renderCurrentChat() {

    const supported =
        Boolean(
            activeTab?.id &&
            isChatGPTUrl(
                activeTab.url
            )
        );


    if (!supported) {

        elements.providerName.textContent =
            "Unsupported";

        elements.conversationTitle.textContent =
            "—";

        elements.conversationTitle.title =
            "";

        elements.providerStatus.textContent =
            "Not available";


        show(
            elements.unsupportedMessage
        );


        return;
    }


    if (!providerInfo) {

        elements.providerName.textContent =
            "ChatGPT";

        elements.conversationTitle.textContent =
            activeTab.title ||
            "—";

        elements.conversationTitle.title =
            activeTab.title ||
            "";

        elements.providerStatus.textContent =
            "Content script unavailable";


        show(
            elements.unsupportedMessage
        );


        elements.unsupportedMessage.textContent =
            "ChatGPT was detected, but the bridge content script is unavailable. Reload this ChatGPT tab after reloading the extension.";


        return;
    }


    hide(
        elements.unsupportedMessage
    );


    elements.providerName.textContent =
        providerInfo.provider ===
            "chatgpt-web"
            ? "ChatGPT"
            : (
                providerInfo.provider ||
                "ChatGPT"
            );


    const title =
        providerInfo.title ||
        activeTab.title ||
        "New conversation";


    elements.conversationTitle.textContent =
        title;

    elements.conversationTitle.title =
        title;


    if (providerInfo.busy) {

        elements.providerStatus.textContent =
            "Busy";

    } else if (
        providerInfo.ready
    ) {

        elements.providerStatus.textContent =
            "Ready";

    } else if (
        providerInfo.detected
    ) {

        elements.providerStatus.textContent =
            "Not ready";

    } else {

        elements.providerStatus.textContent =
            "Not detected";
    }
}


// ============================================================
// Registration UI
// ============================================================

function renderRegistration() {

    if (currentAgent) {

        hide(
            elements.agentForm
        );


        show(
            elements.registeredPanel
        );


        elements.registeredAgentId.textContent =
            currentAgent.agentId;


        return;
    }


    hide(
        elements.registeredPanel
    );


    show(
        elements.agentForm
    );
}


// ============================================================
// Agent list UI
// ============================================================

function renderAgents() {

    elements.agentsList.replaceChildren();


    if (
        !Array.isArray(agents) ||
        agents.length === 0
    ) {

        show(
            elements.agentsEmpty
        );


        hide(
            elements.agentsList
        );


        return;
    }


    hide(
        elements.agentsEmpty
    );


    show(
        elements.agentsList
    );


    const sorted =
        [...agents].sort(
            (a, b) =>
                String(a.agentId)
                    .localeCompare(
                        String(b.agentId)
                    )
        );


    for (
        const agent of sorted
    ) {

        elements.agentsList.appendChild(
            createAgentElement(
                agent
            )
        );
    }
}


// ============================================================
// Agent element
// ============================================================

function createAgentElement(
    agent
) {

    const item =
        document.createElement(
            "div"
        );


    item.className =
        "agent-item";


    // ----------------------------------------------------------
    // Main
    // ----------------------------------------------------------

    const main =
        document.createElement(
            "div"
        );


    main.className =
        "agent-item__main";


    const name =
        document.createElement(
            "span"
        );


    name.className =
        "agent-item__name";

    name.textContent =
        agent.agentId ||
        "unknown";


    const provider =
        document.createElement(
            "span"
        );


    provider.className =
        "agent-item__provider";


    provider.textContent =
        formatProvider(
            agent.provider
        );


    main.append(
        name,
        provider
    );


    // ----------------------------------------------------------
    // State
    // ----------------------------------------------------------

    const state =
        document.createElement(
            "span"
        );


    const agentStatus =
        agent.status ||
        AGENT_STATUS.OFFLINE;


    state.className =
        [
            "agent-state",
            `agent-state--${sanitizeClassName(agentStatus)}`
        ].join(" ");


    state.textContent =
        formatAgentStatus(
            agentStatus
        );


    item.append(
        main,
        state
    );


    return item;
}


// ============================================================
// Register button
// ============================================================

function updateRegisterButton() {

    const agentId =
        elements.agentId
            .value
            .trim();


    const valid =
        isValidAgentId(
            agentId
        );


    const providerReady =
        Boolean(
            providerInfo?.detected &&
            providerInfo?.ready
        );


    elements.registerButton.disabled =
        busy ||
        !valid ||
        !providerReady ||
        Boolean(
            currentAgent
        );
}


// ============================================================
// Busy
// ============================================================

function setBusy(value) {

    busy =
        Boolean(value);


    elements.refreshButton.disabled =
        busy;


    elements.unregisterButton.disabled =
        busy;


    elements.agentId.disabled =
        busy;


    updateRegisterButton();
}


// ============================================================
// Validation
// ============================================================

function isValidAgentId(
    value
) {

    return (
        typeof value === "string" &&
        /^[a-zA-Z0-9_-]+$/.test(
            value
        )
    );
}


// ============================================================
// URL
// ============================================================

function isChatGPTUrl(
    url
) {

    if (
        typeof url !== "string"
    ) {
        return false;
    }


    try {

        const parsed =
            new URL(url);


        return (
            parsed.protocol ===
            "https:" &&
            parsed.hostname ===
            "chatgpt.com"
        );

    } catch {

        return false;
    }
}


// ============================================================
// Formatting
// ============================================================

function formatProvider(
    provider
) {

    switch (provider) {

        case "chatgpt-web":
            return "ChatGPT";

        default:
            return provider || "Unknown";
    }
}


function formatBridgeStatus(
    status
) {

    switch (status) {

        case BRIDGE_STATUS.READY:
            return "Ready";

        case BRIDGE_STATUS.CONNECTED:
            return "Connected";

        case BRIDGE_STATUS.CONNECTING:
            return "Connecting";

        case BRIDGE_STATUS.REGISTERING:
            return "Registering";

        case BRIDGE_STATUS.ERROR:
            return "Error";

        default:
            return "Offline";
    }
}


function formatAgentStatus(
    status
) {

    switch (status) {

        case AGENT_STATUS.IDLE:
            return "idle";

        case AGENT_STATUS.SENDING:
            return "sending";

        case AGENT_STATUS.GENERATING:
            return "generating";

        case AGENT_STATUS.COMPLETED:
            return "completed";

        case AGENT_STATUS.CANCELED:
            return "canceled";

        case AGENT_STATUS.ERROR:
            return "error";

        default:
            return "offline";
    }
}


function sanitizeClassName(
    value
) {

    return String(
        value || "offline"
    )
        .toLowerCase()
        .replace(
            /[^a-z0-9_-]/g,
            ""
        );
}


// ============================================================
// Error UI
// ============================================================

function showError(
    message
) {

    elements.errorMessage.textContent =
        message;


    show(
        elements.errorMessage
    );
}


function clearError() {

    elements.errorMessage.textContent =
        "";


    hide(
        elements.errorMessage
    );
}


// ============================================================
// Visibility
// ============================================================

function show(
    element
) {

    element.classList.remove(
        "hidden"
    );
}


function hide(
    element
) {

    element.classList.add(
        "hidden"
    );
}


// ============================================================
// Start
// ============================================================

initialize().catch(
    (error) => {

        console.error(
            "[Popup] Initialization failed:",
            error
        );


        showError(
            error?.message ||
            String(error)
        );
    }
);