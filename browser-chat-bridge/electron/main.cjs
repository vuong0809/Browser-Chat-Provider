#!/usr/bin/env node

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { DEFAULT_WS_URL, NativeBridge } = require("./native-bridge.cjs");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CHAT_URL = "https://chatgpt.com/";
const DOTENV_PATH = path.join(APP_ROOT, ".env");
const RUNTIME_CONFIG_PATH = path.join(__dirname, "runtime-config.json");

let mainWindow = null;
let bridgePopupWindow = null;
let nativeBridge = null;

function loadDotEnv() {
  if (!fs.existsSync(DOTENV_PATH)) {
    return;
  }

  const content = fs.readFileSync(DOTENV_PATH, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnv();

function getInitialUrl() {
  return process.env.BROWSER_CHAT_PROVIDER_URL || DEFAULT_CHAT_URL;
}

function getWebSocketUrl() {
  const args = process.argv.slice(2);
  const wsUrlIndex = args.indexOf("--ws-url");

  if (wsUrlIndex !== -1 && args[wsUrlIndex + 1]) {
    return args[wsUrlIndex + 1];
  }

  const wsPortIndex = args.indexOf("--ws-port");

  if (wsPortIndex !== -1 && args[wsPortIndex + 1]) {
    return `ws://127.0.0.1:${args[wsPortIndex + 1]}/browser-bridge`;
  }

  return process.env.BROWSER_CHAT_WS_URL || process.env.BROWSER_CHAT_WS_UR || DEFAULT_WS_URL;
}

function getBridgeId() {
  const args = process.argv.slice(2);
  const bridgeIdIndex = args.indexOf("--bridge-id");

  if (bridgeIdIndex !== -1 && args[bridgeIdIndex + 1]) {
    return args[bridgeIdIndex + 1];
  }

  return process.env.BROWSER_CHAT_BRIDGE_ID || undefined;
}
async function insertPromptWithCDP(text) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("ChatGPT window is not available");
  }

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Prompt text is required");
  }

  const debuggerClient =
    mainWindow.webContents.debugger;

  let attachedHere = false;

  try {
    if (!debuggerClient.isAttached()) {
      debuggerClient.attach("1.3");
      attachedHere = true;
    }

    // --------------------------------------------------------
    // Find + focus ChatGPT composer
    // --------------------------------------------------------

    const focusResult =
      await debuggerClient.sendCommand(
        "Runtime.evaluate",
        {
          expression: `
            (() => {
              const composer =
                document.querySelector(
                  'div.ProseMirror[contenteditable="true"]'
                ) ||
                document.querySelector(
                  '[contenteditable="true"][role="textbox"]'
                );

              if (!composer) {
                return {
                  composerFound: false
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

              selection.removeAllRanges();
              selection.addRange(range);

              return {
                composerFound: true,
                existingLength:
                  (
                    composer.innerText ||
                    composer.textContent ||
                    ""
                  ).length
              };
            })()
          `,
          returnByValue: true
        }
      );

    const focusValue =
      focusResult?.result?.value || {};

    if (!focusValue.composerFound) {
      throw new Error(
        "ChatGPT composer not found"
      );
    }

    // --------------------------------------------------------
    // Clear existing composer through native keyboard input
    // --------------------------------------------------------

    await debuggerClient.sendCommand(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: "Control",
        code: "ControlLeft",
        windowsVirtualKeyCode: 17,
        modifiers: 2
      }
    );

    await debuggerClient.sendCommand(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        modifiers: 2
      }
    );

    await debuggerClient.sendCommand(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        modifiers: 2
      }
    );

    await debuggerClient.sendCommand(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: "Control",
        code: "ControlLeft",
        windowsVirtualKeyCode: 17
      }
    );

    await debuggerClient.sendCommand(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8
      }
    );

    await debuggerClient.sendCommand(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8
      }
    );

    // --------------------------------------------------------
    // Browser-native text insertion
    // --------------------------------------------------------

    await debuggerClient.sendCommand(
      "Input.insertText",
      {
        text
      }
    );

    // Give ProseMirror/React a render cycle.
    await new Promise(
      resolve =>
        setTimeout(resolve, 150)
    );

    // --------------------------------------------------------
    // Verify input only.
    //
    // IMPORTANT:
    // Do NOT require the Send button here.
    // --------------------------------------------------------

    const verifyResult =
      await debuggerClient.sendCommand(
        "Runtime.evaluate",
        {
          expression: `
            (() => {
              const composer =
                document.querySelector(
                  'div.ProseMirror[contenteditable="true"]'
                ) ||
                document.querySelector(
                  '[contenteditable="true"][role="textbox"]'
                );

              if (!composer) {
                return {
                  composerFound: false,
                  text: ""
                };
              }

              return {
                composerFound: true,

                text:
                  (
                    composer.innerText ||
                    composer.textContent ||
                    ""
                  ).trim()
              };
            })()
          `,
          returnByValue: true
        }
      );

    const result =
      verifyResult?.result?.value || {};

    console.log(
      "[Electron][CDP] Input completed",
      {
        composerFound:
          result.composerFound,

        expectedLength:
          text.length,

        actualLength:
          typeof result.text === "string"
            ? result.text.length
            : 0,

        previousLength:
          focusValue.existingLength || 0
      }
    );

    if (!result.composerFound) {
      throw new Error(
        "ChatGPT composer disappeared after CDP input"
      );
    }

    if (!result.text) {
      throw new Error(
        "ChatGPT composer is empty after CDP input"
      );
    }

    return {
      composerFound: true,
      textLength: result.text.length,
      expectedLength: text.length
    };

  } finally {

    if (
      attachedHere &&
      debuggerClient.isAttached()
    ) {
      debuggerClient.detach();
    }
  }
}
async function sendPromptToChatGPT({
  content,
  options = {}
}) {

  console.log(
    "[Electron][ChatGPT] sendPromptToChatGPT started",
    {
      contentLength:
        typeof content === "string"
          ? content.length
          : 0,
      timeoutMs:
        options.timeout ||
        options.timeoutMs ||
        180_000,
      url:
        mainWindow &&
          !mainWindow.isDestroyed()
          ? mainWindow.webContents.getURL()
          : null,
      timestamp:
        new Date().toISOString()
    }
  );
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    throw new Error(
      "ChatGPT window is not available"
    );
  }

  const timeoutMs =
    Number(
      options.timeout ||
      options.timeoutMs ||
      180_000
    );

  // Browser-native ProseMirror input.
  console.log(
    "[Electron][ChatGPT] Starting CDP input",
    {
      contentLength: content.length
    }
  );

  const inputResult =
    await insertPromptWithCDP(
      content
    );

  console.log(
    "[Electron][ChatGPT] CDP input successful",
    inputResult
  );

  console.log(
    "[Electron][ChatGPT] Starting renderer send/response flow"
  );

  try {
    const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const timeoutMs = ${JSON.stringify(timeoutMs)};
      const startedAt = Date.now();

      const sleep = (ms) =>
        new Promise(
          resolve => setTimeout(resolve, ms)
        );

      function getText(element) {
        return (
          element?.innerText ||
          element?.textContent ||
          ""
        ).trim();
      }

      function getAssistantTexts() {
        const selectors = [
          '[data-message-author-role="assistant"]',
          '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
        ];

        const nodes =
          Array.from(
            document.querySelectorAll(
              selectors.join(",")
            )
          );

        return nodes
          .map(getText)
          .filter(Boolean);
      }
      function getResponseDiagnostics() {
        const roleNodes =
          Array.from(
            document.querySelectorAll(
              '[data-message-author-role="assistant"]'
            )
          );

        const turnNodes =
          Array.from(
            document.querySelectorAll(
              '[data-testid^="conversation-turn-"]'
            )
          );

        const nestedAssistantNodes =
          Array.from(
            document.querySelectorAll(
              '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
            )
          );

        const lastRoleNode =
          roleNodes.at(-1) || null;

        const lastTurn =
          turnNodes.at(-1) || null;

        const lastTurnAssistant =
          lastTurn?.querySelector(
            '[data-message-author-role="assistant"]'
          ) || null;

        return {
          roleNodeCount:
            roleNodes.length,

          nestedAssistantCount:
            nestedAssistantNodes.length,

          turnCount:
            turnNodes.length,

          lastRoleTextLength:
            getText(lastRoleNode).length,

          lastTurnTextLength:
            getText(lastTurn).length,

          lastTurnAssistantTextLength:
            getText(lastTurnAssistant).length,

          lastTurnTestId:
            lastTurn?.getAttribute(
              "data-testid"
            ) || null,

          lastTurnHasAssistant:
            Boolean(lastTurnAssistant)
        };
      }
      function findComposer() {
        return (
          document.querySelector(
            'div.ProseMirror[contenteditable="true"]'
          ) ||
          document.querySelector(
            '[contenteditable="true"][role="textbox"]'
          ) ||
          document.querySelector("textarea") ||
          document.querySelector(
            '[contenteditable="true"]'
          )
        );
      }

      function findSendButton() {
        const buttons =
          Array.from(
            document.querySelectorAll("button")
          );

        return (
          document.querySelector(
            '[data-testid="send-button"]'
          ) ||
          buttons.find(
            button =>
              /send|submit/i.test(
                button.getAttribute("aria-label") ||
                button.textContent ||
                ""
              )
          )
        );
      }

      async function waitFor(
        condition,
        label
      ) {
        while (
          Date.now() - startedAt <
          timeoutMs
        ) {
          const value =
            condition();

          if (value) {
            return value;
          }

          await sleep(250);
        }

        throw new Error(
          "Timed out waiting for " +
          label
        );
      }

      // Snapshot response before sending.
      const beforeTexts =
        getAssistantTexts();

      const beforeLast =
        beforeTexts.at(-1) || "";

      // Input was already performed by
      // insertPromptWithCDP(content).
      await waitFor(
        findComposer,
        "ChatGPT composer"
      );

      // Wait until ChatGPT exposes its real Send button.
     console.log(
  "[Electron][ChatGPT] Waiting for enabled Send button"
);

const sendButton =
  await waitFor(
    () => {
      const button =
        findSendButton();

      if (
        !button ||
        button.disabled ||
        button.getAttribute(
          "aria-disabled"
        ) === "true"
      ) {
        return null;
      }

      return button;
    },
    "enabled send button"
  );

console.log(
  "[Electron][ChatGPT] Send button ready",
  {
    testId:
      sendButton.getAttribute(
        "data-testid"
      ),
    ariaLabel:
      sendButton.getAttribute(
        "aria-label"
      ),
    disabled:
      Boolean(sendButton.disabled)
  }
);

sendButton.click();

console.log(
  "[Electron][ChatGPT] Send clicked"
);

      let lastText = "";
      let stableCount = 0;
      let generationLogged = false;
      let responseLogged = false;
      let lastDiagnosticSignature = "";

while (
  Date.now() - startedAt <
  timeoutMs
) {
  await sleep(1000);

  const texts =
    getAssistantTexts();

  const current =
    texts.at(-1) || "";
const diagnostics =
    getResponseDiagnostics();

  const diagnosticState = {
    ...diagnostics,

    assistantCount:
      texts.length,

    currentLength:
      current.length,

    beforeLastLength:
      beforeLast.length,

    currentChanged:
      Boolean(
        current &&
        current !== beforeLast
      ),

    stableCount
  };

  const diagnosticSignature =
    JSON.stringify(
      diagnosticState
    );

  if (
    diagnosticSignature !==
    lastDiagnosticSignature
  ) {
    lastDiagnosticSignature =
      diagnosticSignature;

console.log(
  "[Electron][ChatGPT] Response diagnostic " +
  JSON.stringify(diagnosticState)
);
  }
  // Detect whether ChatGPT is still generating.
const stopButton =
  Array.from(
    document.querySelectorAll(
      "button"
    )
  ).find(
    button =>
      /stop/i.test(
        button.getAttribute(
          "aria-label"
        ) ||
        button.textContent ||
        ""
      )
  );

// Diagnostic: log only when Stop state changes.
const stopState =
  Boolean(stopButton);

if (
  stopState !==
  window.__browserChatLastStopState
) {
  window.__browserChatLastStopState =
    stopState;

  console.log(
    "[Electron][ChatGPT] Stop button state " +
    JSON.stringify({
      found: stopState,
      ariaLabel:
        stopButton?.getAttribute(
          "aria-label"
        ) || null,
      text:
        (
          stopButton?.textContent ||
          ""
        )
          .trim()
          .slice(0, 100)
    })
  );
}

if (
  stopButton &&
  !generationLogged
) {
  generationLogged = true;

  console.log(
    "[Electron][ChatGPT] Generation started"
  );
}

  const changed =
    current &&
    current !== beforeLast;

  if (
    changed &&
    !responseLogged
  ) {
    responseLogged = true;

    console.log(
      "[Electron][ChatGPT] Assistant response detected",
      {
        contentLength:
          current.length,
        assistantCount:
          texts.length
      }
    );
  }

  if (!changed) {
    continue;
  }

  if (
    current === lastText
  ) {
    stableCount += 1;
  } else {
    stableCount = 0;
    lastText = current;
  }

  if (
    stableCount >= 2 &&
    !stopButton
  ) {
    const conversationId =
      location.pathname
        .match(
          /\\/c\\/([^/?#]+)/
        )?.[1] ||
      null;

    console.log(
      "[Electron][ChatGPT] Response completed",
      {
        contentLength:
          current.length,
        stableCount,
        durationMs:
          Date.now() -
          startedAt,
        conversationId
      }
    );

    return {
      content:
        current,

      title:
        document.title ||
        null,

      conversationId
    };
  }
}

      throw new Error(
        "Timed out waiting for ChatGPT response"
      );
    })()
  `, true);
    console.log(
      "[Electron][ChatGPT] Renderer flow completed",
      {
        contentLength:
          typeof result?.content === "string"
            ? result.content.length
            : 0,
        conversationId:
          result?.conversationId || null
      }
    );
    return result;
  } catch (error) {
    console.error(
      "[Electron][ChatGPT] Renderer flow failed",
      {
        error:
          error instanceof Error
            ? error.stack || error.message
            : String(error)
      }
    );
    throw error;
  }
}

function writeRuntimeConfig() {
  const wsUrl = getWebSocketUrl();
  const config = {};

  if (wsUrl) {
    try {
      const url = new URL(wsUrl);

      if (url.protocol !== "ws:" && url.protocol !== "wss:") {
        throw new Error("BROWSER_CHAT_WS_URL must start with ws:// or wss://");
      }

      config.wsUrl = wsUrl;
    } catch (error) {
      throw new Error(
        `Invalid BROWSER_CHAT_WS_URL: ${error instanceof Error ? error.message : wsUrl}`
      );
    }
  }

  fs.writeFileSync(
    RUNTIME_CONFIG_PATH,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );
}

function createMenu() {
  const template = [
    {
      label: "Browser Chat",
      submenu: [
        {
          label: "Show Bridge Popup",
          accelerator: "CmdOrCtrl+Shift+B",
          click: () => showBridgePopup()
        },
        { type: "separator" },
        {
          label: "Reload Chat",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.reload()
        },
        {
          label: "Toggle DevTools",
          accelerator: "F12",
          click: () => mainWindow?.webContents.toggleDevTools()
        },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit()
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showBridgePopup() {
  if (bridgePopupWindow && !bridgePopupWindow.isDestroyed()) {
    bridgePopupWindow.show();
    bridgePopupWindow.focus();
    return;
  }

  bridgePopupWindow = new BrowserWindow({
    width: 430,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    title: "Browser Chat Bridge",
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, "native-popup-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  bridgePopupWindow.on("closed", () => {
    bridgePopupWindow = null;
  });

  bridgePopupWindow.loadFile(path.join(__dirname, "native-popup.html"));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 960,
    minHeight: 720,
    title: "Browser Chat Provider",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.webContents.on(
    "console-message",
    (_event, level, message) => {
      if (
        typeof message === "string" &&
        message.includes("[Electron][ChatGPT]")
      ) {
        console.log(
          "[Electron][Renderer]",
          message
        );
      }
    }
  );
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://chatgpt.com/")) {
      return { action: "allow" };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(getInitialUrl());
}

async function main() {
  await app.whenReady();

  writeRuntimeConfig();
  createMenu();

  nativeBridge = new NativeBridge({
    wsUrl: getWebSocketUrl(),
    bridgeId: getBridgeId(),
    chatHandler: sendPromptToChatGPT
  });

  nativeBridge.on("status", status => {
    if (bridgePopupWindow && !bridgePopupWindow.isDestroyed()) {
      bridgePopupWindow.webContents.send("native-bridge:status", status);
    }
  });

  nativeBridge.on("error", error => {
    console.error("[NativeBridge]", error);
  });

  nativeBridge.connect();

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}

ipcMain.handle("native-bridge:get-status", () => nativeBridge?.getStatus());

ipcMain.handle("native-bridge:register-agent", (_event, { agentId }) => {
  const title = mainWindow?.webContents.getTitle() || null;
  return nativeBridge?.registerAgent({ agentId, title });
});

ipcMain.handle("native-bridge:unregister-agent", (_event, { agentId }) => {
  nativeBridge?.unregisterAgent(agentId);
  return { ok: true };
});


app.on("window-all-closed", () => {
  nativeBridge?.disconnect();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

main().catch((error) => {
  console.error("Failed to start Browser Chat Provider Electron app:", error);
  app.exit(1);
});
