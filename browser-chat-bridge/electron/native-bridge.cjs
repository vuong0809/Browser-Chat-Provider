"use strict";

const { EventEmitter } = require("node:events");

const DEFAULT_WS_URL = "ws://127.0.0.1:20128/browser-bridge";
const DEFAULT_BRIDGE_ID = "electron-main";
const BRIDGE_VERSION = "0.1.0";
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

function generateId(prefix = "msg") {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${random}`;
}

function createEnvelope(type) {
  return {
    v: 1,
    type,
    timestamp: Date.now()
  };
}

function createRequest(method, payload = {}, id = null) {
  return {
    ...createEnvelope("request"),
    id: id || generateId("req"),
    method,
    payload
  };
}

function createEvent(method, payload = {}) {
  return {
    ...createEnvelope("event"),
    id: generateId("evt"),
    method,
    payload
  };
}

function createError(requestId, code, message, details = null) {
  const error = {
    code,
    message
  };

  if (details !== null && details !== undefined) {
    error.details = details;
  }

  return {
    ...createEnvelope("error"),
    id: requestId || generateId("err"),
    error
  };
}

function getWebSocketConstructor() {
  if (typeof WebSocket === "function") {
    return WebSocket;
  }

  try {
    return require("ws");
  } catch {
    throw new Error("WebSocket is unavailable in this Electron runtime");
  }
}

class NativeBridge extends EventEmitter {
  constructor({ wsUrl = DEFAULT_WS_URL, bridgeId = DEFAULT_BRIDGE_ID } = {}) {
    super();

    this.wsUrl = wsUrl;
    this.bridgeId = bridgeId;
    this.status = "disconnected";
    this.websocket = null;
    this.registrationRequestId = null;
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.agents = new Map();
  }

  connect() {
    if (this.websocket) {
      return;
    }

    const WebSocketCtor = getWebSocketConstructor();
    this.setStatus("connecting");

    const websocket = new WebSocketCtor(this.wsUrl);
    this.websocket = websocket;

    websocket.addEventListener("open", () => this.handleOpen());
    websocket.addEventListener("message", event => this.handleMessage(event.data));
    websocket.addEventListener("error", event => this.emit("error", event.error || event));
    websocket.addEventListener("close", () => this.handleClose());
  }

  disconnect() {
    this.stopHeartbeat();

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    this.setStatus("disconnected");
  }

  getStatus() {
    return {
      bridgeId: this.bridgeId,
      status: this.status,
      wsUrl: this.wsUrl,
      connected: this.status === "ready" || this.status === "connected",
      agents: Array.from(this.agents.values())
    };
  }

  registerAgent({ agentId, title = null, conversationId = null }) {
    const normalizedAgentId = String(agentId || "").trim();

    if (!/^[a-zA-Z0-9_-]+$/.test(normalizedAgentId)) {
      throw new Error("Agent name may contain only letters, numbers, hyphen and underscore.");
    }

    const agent = {
      agentId: normalizedAgentId,
      bridgeId: this.bridgeId,
      provider: "chatgpt-web",
      tabId: 1,
      conversationId,
      title,
      status: "idle",
      capabilities: ["text", "stream", "cancel"]
    };

    this.agents.set(normalizedAgentId, agent);
    this.announceAgent(agent);
    this.emitStatus();

    return agent;
  }

  unregisterAgent(agentId) {
    const agent = this.agents.get(agentId);
    this.agents.delete(agentId);

    if (agent && this.status === "ready") {
      this.send(createEvent("agent.unregister", {
        bridgeId: this.bridgeId,
        agentId
      }));
    }

    this.emitStatus();
  }

  handleOpen() {
    this.setStatus("registering");

    const request = createRequest("bridge.register", {
      bridgeId: this.bridgeId,
      name: "Electron Native",
      bridgeVersion: BRIDGE_VERSION,
      capabilities: ["text", "stream", "cancel", "tab-discovery"]
    });

    this.registrationRequestId = request.id;
    this.send(request);
  }

  handleClose() {
    this.websocket = null;
    this.registrationRequestId = null;
    this.stopHeartbeat();
    this.setStatus("disconnected");
  }

  handleMessage(rawData) {
    let message;

    try {
      message = JSON.parse(String(rawData));
    } catch (error) {
      this.emit("error", error);
      return;
    }

    if (
      this.registrationRequestId &&
      message.type === "response" &&
      message.id === this.registrationRequestId
    ) {
      this.registrationRequestId = null;
      this.heartbeatIntervalMs = message.result?.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
      this.setStatus("ready");
      this.startHeartbeat();
      this.announceAllAgents();
      return;
    }

    if (message.type === "request" && message.method === "chat.send") {
      this.handleChatSend(message);
      return;
    }

    if (message.type === "request" && message.method === "chat.cancel") {
      this.send(createError(
        message.id,
        "NOT_IMPLEMENTED",
        "Native Electron chat.cancel is not implemented in Phase 1"
      ));
    }
  }

  handleChatSend(message) {
    const agentId = message.payload?.agentId;
    const agent = this.agents.get(agentId);

    if (!agent) {
      this.send(createError(
        message.id,
        "AGENT_NOT_FOUND",
        `Agent "${agentId}" is not registered in Electron native bridge`
      ));
      return;
    }

    this.send(createError(
      message.id,
      "NOT_IMPLEMENTED",
      "Native Electron chat.send routing is not implemented in Phase 1",
      {
        agentId,
        nextPhase: "Inject ChatGPT adapter through preload/executeJavaScript and route chat.send via Electron IPC"
      }
    ));
  }

  announceAllAgents() {
    for (const agent of this.agents.values()) {
      this.announceAgent(agent);
    }
  }

  announceAgent(agent) {
    if (this.status !== "ready") {
      return;
    }

    this.send(createEvent("agent.register", agent));
  }

  startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      this.send(createEvent("bridge.heartbeat", {
        bridgeId: this.bridgeId,
        status: this.status,
        agentCount: this.agents.size
      }));
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  send(message) {
    if (!this.websocket || this.websocket.readyState !== 1) {
      return false;
    }

    this.websocket.send(JSON.stringify(message));
    return true;
  }

  setStatus(status) {
    this.status = status;
    this.emitStatus();
  }

  emitStatus() {
    this.emit("status", this.getStatus());
  }
}

module.exports = {
  DEFAULT_WS_URL,
  NativeBridge
};
