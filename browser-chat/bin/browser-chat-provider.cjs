#!/usr/bin/env node

"use strict";

const path = require("node:path");
const http = require("node:http");

const {
  browserChatAsk,
  browserChatList,
  createBrowserChatModule,
  createBrowserChatOpenAIAdapter,
  createBrowserChatOpenAIHttpHandler
} = require(path.join(__dirname, "..", "dist", "browser-chat.cjs"));

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 20128;
const DEFAULT_PATH = "/browser-bridge";
const OPENAI_BASE_PATH = "/browser-chat-openai/v1";

function printHelp() {
  console.log(`Browser Chat Provider

Usage:
  browser-chat-provider [options]

Options:
  --host <host>    HTTP/WebSocket host. Default: ${DEFAULT_HOST}
  --port <port>    HTTP/WebSocket port. Default: ${DEFAULT_PORT}
  --path <path>    WebSocket path. Default: ${DEFAULT_PATH}
  --help           Show this help message.

Examples:
  npm start
  npm start -- --port 20128
  node bin/browser-chat-provider.cjs --host 127.0.0.1 --port 20128
`);
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name);

  if (index === -1) {
    return fallback;
  }

  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function parseOptions(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      help: true
    };
  }

  const host = readOption(
    args,
    "--host",
    process.env.BROWSER_CHAT_HOST || DEFAULT_HOST
  );

  const portValue = readOption(
    args,
    "--port",
    process.env.BROWSER_CHAT_PORT || String(DEFAULT_PORT)
  );

  const websocketPath = readOption(
    args,
    "--path",
    process.env.BROWSER_CHAT_PATH || DEFAULT_PATH
  );

  const port = Number(portValue);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${portValue}`);
  }

  if (!websocketPath.startsWith("/")) {
    throw new Error("--path must start with /");
  }

  return {
    help: false,
    host,
    port,
    path: websocketPath
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const browserChat = createBrowserChatModule({
    websocketMode: "attached",
    host: options.host,
    port: options.port,
    path: options.path
  });

  await browserChat.start();

  const openAIAdapter = createBrowserChatOpenAIAdapter({
    browserChatAsk,
    browserChatList,
    requestManager: browserChat.requestManager,
    agentRegistry: browserChat.agentRegistry
  });

  const openAIHandler = createBrowserChatOpenAIHttpHandler(openAIAdapter);

  const server = http.createServer(async (request, response) => {
    try {
      if (await openAIHandler.handle(request, response)) {
        return;
      }

      response.writeHead(404, {
        "content-type": "application/json"
      });

      response.end(JSON.stringify({
        error: {
          message: "Not found",
          type: "invalid_request_error",
          param: null,
          code: "not_found"
        }
      }));
    } catch (error) {
      response.writeHead(500, {
        "content-type": "application/json"
      });

      response.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : "Internal server error",
          type: "internal_server_error",
          param: null,
          code: "internal_server_error"
        }
      }));
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (browserChat.handleUpgrade(request, socket, head)) {
      return;
    }

    socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const websocketUrl = `ws://${options.host}:${options.port}${options.path}`;
  const openAIUrl = `http://${options.host}:${options.port}${OPENAI_BASE_PATH}`;

  console.log(`Browser Chat Provider WebSocket running at ${websocketUrl}`);
  console.log(`OpenAI-compatible API running at ${openAIUrl}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Stopping Browser Chat Provider...`);

    try {
      await new Promise((resolve) => server.close(resolve));
      await browserChat.stop();
      process.exit(0);
    } catch (error) {
      console.error("Failed to stop Browser Chat Provider:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start Browser Chat Provider:", error);
  process.exit(1);
});
