// src/content/content-script.js

import {
  NetworkResponseBridge
} from "./network-response-bridge.js";

import {
  INTERNAL_MESSAGE
} from "../protocol/constants.js";

import {
  ChatGPTAdapter
} from "../providers/chatgpt/ChatGPTAdapter.js";

import {
  PageObserver
} from "./observer.js";

import {
  ContentMessageHandler
} from "./message-handler.js";


// ============================================================
// Runtime state
// ============================================================
let networkResponseBridge =
  null;

let initialized =
  false;


let initializing =
  false;


let adapter =
  null;


let messageHandler =
  null;


let pageObserver =
  null;


let lastReportedState =
  null;


// ============================================================
// Initialize
// ============================================================

async function initialize() {

  if (
    initialized ||
    initializing
  ) {
    return;
  }


  initializing =
    true;


  console.log(
    "[BrowserChatBridge] Initializing content script..."
  );


  try {

    // --------------------------------------------------------
    // Provider
    // --------------------------------------------------------

    adapter =
      new ChatGPTAdapter({
        timeoutMs:
          180_000,

        composerTimeoutMs:
          10_000,

        settleMs:
          1_200,

        pollIntervalMs:
          250
      });


    await adapter.initialize();


    // --------------------------------------------------------
    // Message handler
    // --------------------------------------------------------

    messageHandler =
      new ContentMessageHandler({
        adapter
      });


    // --------------------------------------------------------
    // Network response bridge
    // --------------------------------------------------------

    networkResponseBridge =
      new NetworkResponseBridge({

        onEvent:
          (event) => {

            /*
             * Forward parsed ChatGPT network events
             * to ContentMessageHandler.
             *
             * Network SSE will become the primary
             * response source.
             */

            if (
              messageHandler &&
              typeof messageHandler
                .handleNetworkEvent ===
              "function"
            ) {

              messageHandler
                .handleNetworkEvent(
                  event
                );
            }
          }
      });


    networkResponseBridge.start();
    messageHandler.start();


    // --------------------------------------------------------
    // Page observer
    // --------------------------------------------------------

    pageObserver =
      new PageObserver({
        adapter,

        debounceMs:
          250,

        pollIntervalMs:
          1_000,

        onChange:
          ({ current }) => {

            reportProviderState(
              current
            );
          }
      });


    pageObserver.start();


    // --------------------------------------------------------
    // Initial provider announcement
    // --------------------------------------------------------

    reportProviderDetected();


    reportProviderState(
      pageObserver.getState()
    );


    initialized =
      true;


    console.log(
      "[BrowserChatBridge] Content script ready",
      {
        provider:
          adapter.providerId,

        conversationId:
          adapter.getConversationId(),

        title:
          adapter.getTitle()
      }
    );

  } catch (error) {

    console.error(
      "[BrowserChatBridge] Content initialization failed:",
      error
    );


    await cleanup();

  } finally {

    initializing =
      false;
  }
}


// ============================================================
// Provider detected
// ============================================================

function reportProviderDetected() {

  if (!adapter) {
    return;
  }


  sendToBackground({
    type:
      INTERNAL_MESSAGE.PROVIDER_DETECTED,

    provider:
      adapter.providerId,

    detected:
      adapter.detect(),

    ready:
      adapter.isReady(),

    conversationId:
      adapter.getConversationId(),

    title:
      adapter.getTitle()
  });
}


// ============================================================
// Provider state
// ============================================================

function reportProviderState(
  state
) {

  if (!state) {
    return;
  }


  const normalized = {
    provider:
      adapter?.providerId ??
      null,

    detected:
      Boolean(
        state.detected
      ),

    ready:
      Boolean(
        state.ready
      ),

    busy:
      Boolean(
        state.busy
      ),

    conversationId:
      state.conversationId ??
      null,

    title:
      state.title ??
      null,

    pathname:
      state.pathname ??
      null
  };


  // ----------------------------------------------------------
  // Avoid duplicate status messages
  // ----------------------------------------------------------

  if (
    lastReportedState &&
    statesEqual(
      lastReportedState,
      normalized
    )
  ) {
    return;
  }


  lastReportedState =
    normalized;


  sendToBackground({
    type:
      INTERNAL_MESSAGE.PROVIDER_STATUS,

    ...normalized
  });
}


// ============================================================
// State comparison
// ============================================================

function statesEqual(
  a,
  b
) {

  return (
    a.provider === b.provider &&
    a.detected === b.detected &&
    a.ready === b.ready &&
    a.busy === b.busy &&
    a.conversationId ===
    b.conversationId &&
    a.title === b.title &&
    a.pathname === b.pathname
  );
}


// ============================================================
// Send to background
// ============================================================

function sendToBackground(
  message
) {

  try {

    const result =
      chrome.runtime.sendMessage(
        message
      );


    /*
     * MV3 service worker may be sleeping or restarting.
     * Avoid unhandled promise rejection.
     */

    if (
      result &&
      typeof result.catch ===
      "function"
    ) {

      result.catch(
        (error) => {

          console.debug(
            "[BrowserChatBridge] Background unavailable:",
            error
          );
        }
      );
    }

  } catch (error) {

    console.debug(
      "[BrowserChatBridge] Failed to send background message:",
      error
    );
  }
}


// ============================================================
// Cleanup
// ============================================================

async function cleanup() {

  console.log(
    "[BrowserChatBridge] Cleaning up content script..."
  );


  // ----------------------------------------------------------
  // Page observer
  // ----------------------------------------------------------

  if (pageObserver) {

    try {
      pageObserver.stop();
    } catch (error) {

      console.debug(
        "[BrowserChatBridge] PageObserver stop failed:",
        error
      );
    }


    pageObserver =
      null;
  }

  // ----------------------------------------------------------
  // Network response bridge
  // ----------------------------------------------------------

  if (networkResponseBridge) {

    try {

      networkResponseBridge.stop();

    } catch (error) {

      console.debug(
        "[BrowserChatBridge] NetworkResponseBridge stop failed:",
        error
      );
    }


    networkResponseBridge =
      null;
  }
  // ----------------------------------------------------------
  // Message handler
  // ----------------------------------------------------------

  if (messageHandler) {

    try {
      messageHandler.stop();
    } catch (error) {

      console.debug(
        "[BrowserChatBridge] MessageHandler stop failed:",
        error
      );
    }


    messageHandler =
      null;
  }


  // ----------------------------------------------------------
  // Adapter
  // ----------------------------------------------------------

  if (adapter) {

    try {
      await adapter.destroy();
    } catch (error) {

      console.debug(
        "[BrowserChatBridge] Adapter destroy failed:",
        error
      );
    }


    adapter =
      null;
  }


  lastReportedState =
    null;


  initialized =
    false;
}


// ============================================================
// Page lifecycle
// ============================================================

window.addEventListener(
  "pagehide",
  () => {

    cleanup().catch(
      (error) => {

        console.debug(
          "[BrowserChatBridge] Cleanup failed:",
          error
        );
      }
    );
  },
  {
    once: true
  }
);


// ============================================================
// Extension invalidation guard
// ============================================================

/*
 * During extension development, reloading the unpacked
 * extension invalidates the previous extension context.
 *
 * The old content script may still exist briefly in the page.
 * This helper lets us detect that situation before initialization.
 */

function extensionContextAvailable() {

  try {

    return Boolean(
      chrome?.runtime?.id
    );

  } catch {

    return false;
  }
}


// ============================================================
// Bootstrap
// ============================================================

async function bootstrap() {

  if (
    !extensionContextAvailable()
  ) {

    console.warn(
      "[BrowserChatBridge] Extension context unavailable"
    );

    return;
  }


  // ----------------------------------------------------------
  // Verify provider host
  // ----------------------------------------------------------

  if (
    window.location.hostname !==
    "chatgpt.com"
  ) {

    console.debug(
      "[BrowserChatBridge] Unsupported host:",
      window.location.hostname
    );

    return;
  }


  await initialize();
}


bootstrap().catch(
  (error) => {

    console.error(
      "[BrowserChatBridge] Bootstrap failed:",
      error
    );
  }
);