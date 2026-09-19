#!/usr/bin/env node

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { DEFAULT_WS_URL, NativeBridge } = require("./native-bridge.cjs");

const {
  chatGPTResponseScript
} = require("./chatgpt-response-script.cjs");

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
    const result =
      await mainWindow.webContents.executeJavaScript(
        `(${chatGPTResponseScript.toString()})(${JSON.stringify(timeoutMs)})`,
        true
      );
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
