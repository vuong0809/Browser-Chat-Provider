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

async function sendPromptToChatGPT({ content, options = {} }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("ChatGPT window is not available");
  }

  const timeoutMs = Number(options.timeout || options.timeoutMs || 180_000);

  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      const prompt = ${JSON.stringify(content)};
      const timeoutMs = ${JSON.stringify(timeoutMs)};
      const startedAt = Date.now();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      function getText(element) {
        return (element?.innerText || element?.textContent || "").trim();
      }

      function getAssistantTexts() {
        const selectors = [
          '[data-message-author-role="assistant"]',
          '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
        ];

        const nodes = Array.from(document.querySelectorAll(selectors.join(',')));
        return nodes.map(getText).filter(Boolean);
      }

      function findComposer() {
        return document.querySelector('div.ProseMirror[contenteditable="true"]') ||
          document.querySelector('[contenteditable="true"][role="textbox"]') ||
          document.querySelector('textarea') ||
          document.querySelector('[contenteditable="true"]');
      }

      function findSendButton() {
        const buttons = Array.from(document.querySelectorAll('button'));
        return document.querySelector('[data-testid="send-button"]') ||
          buttons.find((button) => /send|submit/i.test(button.getAttribute('aria-label') || button.textContent || '')) ||
          buttons.find((button) => button.querySelector('svg') && !button.disabled);
      }

      function setComposerText(composer, text) {
        composer.focus();

        if ('value' in composer) {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value') ||
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

          if (descriptor?.set) {
            descriptor.set.call(composer, text);
          } else {
            composer.value = text;
          }

          composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          return;
        }

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        selection.removeAllRanges();
        selection.addRange(range);

        try {
          document.execCommand('delete', false);
          document.execCommand('insertText', false, text);
        } catch {
          composer.textContent = text;
        }

        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }

      async function waitFor(condition, label) {
        while (Date.now() - startedAt < timeoutMs) {
          const value = condition();
          if (value) return value;
          await sleep(250);
        }

        throw new Error('Timed out waiting for ' + label);
      }

      const beforeTexts = getAssistantTexts();
      const beforeLast = beforeTexts.at(-1) || '';
      const composer = await waitFor(findComposer, 'ChatGPT composer');
      setComposerText(composer, prompt);

      const sendButton = await waitFor(() => {
        const button = findSendButton();
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
        return button;
      }, 'enabled send button');

      sendButton.click();

      let lastText = '';
      let stableCount = 0;

      while (Date.now() - startedAt < timeoutMs) {
        await sleep(1000);

        const texts = getAssistantTexts();
        const current = texts.at(-1) || '';
        const changed = current && current !== beforeLast;

        if (!changed) {
          continue;
        }

        if (current === lastText) {
          stableCount += 1;
        } else {
          stableCount = 0;
          lastText = current;
        }

        const stopButton = Array.from(document.querySelectorAll('button'))
          .find((button) => /stop/i.test(button.getAttribute('aria-label') || button.textContent || ''));

        if (stableCount >= 2 && !stopButton) {
          return {
            content: current,
            title: document.title || null,
            conversationId: location.pathname.match(/\/c\/([^/?#]+)/)?.[1] || null
          };
        }
      }

      throw new Error('Timed out waiting for ChatGPT response');
    })()
  `, true);
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
