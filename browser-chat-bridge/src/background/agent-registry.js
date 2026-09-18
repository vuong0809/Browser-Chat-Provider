// src/background/agent-registry.js

import {
  AGENT_STATUS,
  STORAGE_KEY
} from "../protocol/constants.js";


// ============================================================
// Agent Registry
// ============================================================

export class AgentRegistry {

  constructor() {
    this.agents = new Map();

    this.initialized = false;
  }


  // ==========================================================
  // Initialization
  // ==========================================================

  async initialize() {

    if (this.initialized) {
      return;
    }

    try {

      const result =
        await chrome.storage.local.get(
          STORAGE_KEY.AGENTS
        );

      const storedAgents =
        result[STORAGE_KEY.AGENTS];

      if (Array.isArray(storedAgents)) {

        for (const agent of storedAgents) {

          if (!this._isValidStoredAgent(agent)) {
            continue;
          }

          /*
           * A restored agent must not be considered busy.
           *
           * Chrome may have killed the service worker while
           * the previous state was GENERATING/SENDING.
           */
          agent.status =
            AGENT_STATUS.OFFLINE;

          agent.activeRequestId = null;

          this.agents.set(
            agent.agentId,
            agent
          );
        }
      }

      this.initialized = true;

      console.log(
        "[AgentRegistry] Initialized:",
        this.agents.size,
        "agent(s)"
      );

    } catch (error) {

      console.error(
        "[AgentRegistry] Initialization failed:",
        error
      );

      throw error;
    }
  }


  // ==========================================================
  // Register
  // ==========================================================

  async register(agent) {

    this._assertInitialized();

    this._validateAgent(agent);

    const now =
      Date.now();

    const existing =
      this.agents.get(
        agent.agentId
      );

    const record = {

      agentId:
        agent.agentId,

      provider:
        agent.provider,

      tabId:
        agent.tabId,

      conversationId:
        agent.conversationId ?? null,

      title:
        agent.title ?? null,

      status:
        agent.status ??
        AGENT_STATUS.IDLE,

      capabilities:
        Array.isArray(agent.capabilities)
          ? [...agent.capabilities]
          : [],

      activeRequestId:
        null,

      createdAt:
        existing?.createdAt ?? now,

      updatedAt:
        now
    };


    /*
     * An agentId represents one logical browser agent.
     *
     * Registering the same agentId again replaces the
     * previous tab mapping.
     */
    this.agents.set(
      record.agentId,
      record
    );


    await this._persist();


    console.log(
      "[AgentRegistry] Registered:",
      record.agentId,
      "→ tab",
      record.tabId
    );


    return this._clone(record);
  }


  // ==========================================================
  // Unregister
  // ==========================================================

  async unregister(agentId) {

    this._assertInitialized();

    this._validateAgentId(
      agentId
    );


    const existing =
      this.agents.get(agentId);

    if (!existing) {
      return false;
    }


    this.agents.delete(
      agentId
    );


    await this._persist();


    console.log(
      "[AgentRegistry] Unregistered:",
      agentId
    );


    return true;
  }


  // ==========================================================
  // Get
  // ==========================================================

  get(agentId) {

    this._assertInitialized();

    const agent =
      this.agents.get(agentId);

    if (!agent) {
      return null;
    }

    return this._clone(agent);
  }


  // ==========================================================
  // Get by tab
  // ==========================================================

  getByTabId(tabId) {

    this._assertInitialized();

    for (const agent of this.agents.values()) {

      if (agent.tabId === tabId) {
        return this._clone(agent);
      }
    }

    return null;
  }


  // ==========================================================
  // List
  // ==========================================================

  list() {

    this._assertInitialized();

    return Array
      .from(this.agents.values())
      .map(
        (agent) =>
          this._clone(agent)
      );
  }


  // ==========================================================
  // Exists
  // ==========================================================

  has(agentId) {

    this._assertInitialized();

    return this.agents.has(
      agentId
    );
  }


  // ==========================================================
  // Update
  // ==========================================================

  async update(
    agentId,
    changes = {}
  ) {

    this._assertInitialized();

    this._validateAgentId(
      agentId
    );


    const agent =
      this.agents.get(agentId);


    if (!agent) {

      throw new Error(
        `Agent not found: ${agentId}`
      );
    }


    /*
     * agentId itself must never change through update().
     */
    const {
      agentId: ignoredAgentId,
      createdAt: ignoredCreatedAt,
      ...allowedChanges
    } = changes;


    const updated = {
      ...agent,
      ...allowedChanges,

      agentId:
        agent.agentId,

      createdAt:
        agent.createdAt,

      updatedAt:
        Date.now()
    };


    this.agents.set(
      agentId,
      updated
    );


    await this._persist();


    return this._clone(updated);
  }


  // ==========================================================
  // Status
  // ==========================================================

  async setStatus(
    agentId,
    status
  ) {

    if (
      !Object
        .values(AGENT_STATUS)
        .includes(status)
    ) {

      throw new Error(
        `Invalid agent status: ${status}`
      );
    }


    return this.update(
      agentId,
      {
        status
      }
    );
  }


  // ==========================================================
  // Active request
  // ==========================================================

  async setActiveRequest(
    agentId,
    requestId
  ) {

    this._assertInitialized();


    if (
      typeof requestId !== "string" ||
      !requestId.trim()
    ) {

      throw new Error(
        "requestId is required"
      );
    }


    const agent =
      this.agents.get(agentId);


    if (!agent) {

      throw new Error(
        `Agent not found: ${agentId}`
      );
    }


    /*
     * MVP rule:
     *
     * One agent may process only one request at a time.
     */
    if (
      agent.activeRequestId &&
      agent.activeRequestId !== requestId
    ) {

      throw new Error(
        `Agent "${agentId}" is busy with request ${agent.activeRequestId}`
      );
    }


    return this.update(
      agentId,
      {
        activeRequestId:
          requestId,

        status:
          AGENT_STATUS.SENDING
      }
    );
  }


  async clearActiveRequest(
    agentId,
    requestId = null
  ) {

    this._assertInitialized();


    const agent =
      this.agents.get(agentId);


    if (!agent) {
      return null;
    }


    /*
     * If requestId is supplied, only clear the active request
     * when it matches.
     *
     * This prevents an old completion event from accidentally
     * clearing a newer request.
     */
    if (
      requestId &&
      agent.activeRequestId !== requestId
    ) {

      return this._clone(agent);
    }


    return this.update(
      agentId,
      {
        activeRequestId:
          null,

        status:
          AGENT_STATUS.IDLE
      }
    );
  }


  // ==========================================================
  // Busy
  // ==========================================================

  isBusy(agentId) {

    this._assertInitialized();


    const agent =
      this.agents.get(agentId);


    if (!agent) {
      return false;
    }


    return Boolean(
      agent.activeRequestId
    );
  }


  // ==========================================================
  // Conversation metadata
  // ==========================================================

  async updateConversation(
    agentId,
    {
      conversationId,
      title
    }
  ) {

    const changes = {};


    if (
      conversationId !== undefined
    ) {
      changes.conversationId =
        conversationId;
    }


    if (
      title !== undefined
    ) {
      changes.title =
        title;
    }


    return this.update(
      agentId,
      changes
    );
  }


  // ==========================================================
  // Tab lifecycle
  // ==========================================================

  async markTabOffline(tabId) {

    this._assertInitialized();

    const affected = [];


    for (const agent of this.agents.values()) {

      if (agent.tabId !== tabId) {
        continue;
      }


      agent.status =
        AGENT_STATUS.OFFLINE;

      agent.activeRequestId =
        null;

      agent.updatedAt =
        Date.now();


      affected.push(
        this._clone(agent)
      );
    }


    if (affected.length > 0) {
      await this._persist();
    }


    return affected;
  }


  // ==========================================================
  // Remove agents belonging to closed tab
  // ==========================================================

  async removeByTabId(tabId) {

    this._assertInitialized();

    const removed = [];


    for (
      const [agentId, agent]
      of this.agents.entries()
    ) {

      if (agent.tabId !== tabId) {
        continue;
      }


      removed.push(
        this._clone(agent)
      );


      this.agents.delete(
        agentId
      );
    }


    if (removed.length > 0) {

      await this._persist();

      console.log(
        "[AgentRegistry] Removed agents for closed tab:",
        tabId,
        removed.map(
          (agent) => agent.agentId
        )
      );
    }


    return removed;
  }


  // ==========================================================
  // Validate browser tabs
  // ==========================================================

  async validateTabs() {

    this._assertInitialized();

    const agents =
      Array.from(
        this.agents.values()
      );

    let changed =
      false;


    for (const agent of agents) {

      try {

        const tab =
          await chrome.tabs.get(
            agent.tabId
          );


        /*
         * The tab exists.
         *
         * We do not automatically mark it IDLE here because
         * the content script may not yet be ready.
         */
        if (!tab) {

          agent.status =
            AGENT_STATUS.OFFLINE;

          agent.activeRequestId =
            null;

          changed =
            true;
        }

      } catch {

        agent.status =
          AGENT_STATUS.OFFLINE;

        agent.activeRequestId =
          null;

        changed =
          true;
      }
    }


    if (changed) {
      await this._persist();
    }


    return this.list();
  }


  // ==========================================================
  // Clear
  // ==========================================================

  async clear() {

    this._assertInitialized();

    this.agents.clear();

    await this._persist();
  }


  // ==========================================================
  // Persistence
  // ==========================================================

  async _persist() {

    const data =
      Array.from(
        this.agents.values()
      );


    await chrome.storage.local.set({
      [STORAGE_KEY.AGENTS]:
        data
    });
  }


  // ==========================================================
  // Validation
  // ==========================================================

  _validateAgent(agent) {

    if (
      !agent ||
      typeof agent !== "object"
    ) {

      throw new Error(
        "Agent must be an object"
      );
    }


    this._validateAgentId(
      agent.agentId
    );


    if (
      typeof agent.provider !== "string" ||
      !agent.provider.trim()
    ) {

      throw new Error(
        "Agent provider is required"
      );
    }


    if (
      !Number.isInteger(agent.tabId) ||
      agent.tabId < 0
    ) {

      throw new Error(
        "Agent tabId must be a valid integer"
      );
    }
  }


  _validateAgentId(agentId) {

    if (
      typeof agentId !== "string" ||
      !agentId.trim()
    ) {

      throw new Error(
        "agentId is required"
      );
    }


    /*
     * Keep agent names simple because they may later
     * appear in Codex tool calls.
     *
     * Valid examples:
     *
     * architect
     * code-reviewer
     * mes_architect
     */
    if (
      !/^[a-zA-Z0-9_-]+$/.test(
        agentId
      )
    ) {

      throw new Error(
        "agentId may contain only letters, numbers, '-' and '_'"
      );
    }
  }


  _isValidStoredAgent(agent) {

    try {

      this._validateAgent(agent);

      return true;

    } catch {

      return false;
    }
  }


  // ==========================================================
  // Internal
  // ==========================================================

  _assertInitialized() {

    if (!this.initialized) {

      throw new Error(
        "AgentRegistry is not initialized"
      );
    }
  }


  _clone(agent) {

    return {
      ...agent,

      capabilities:
        Array.isArray(agent.capabilities)
          ? [...agent.capabilities]
          : []
    };
  }
}