// browser-chat/agent-registry.ts

import {
    AGENT_STATUS,
    ERROR_CODE
} from "./protocol/constants";

import type {
    AgentRegisterPayload,
    AgentStatus,
    AgentStatusPayload,
    BrowserChatAgent,
    Capability
} from "./protocol/types";

import {
    createLogger
} from "./shared/logger";

import {
    isValidAgentId,
    now
} from "./shared/utils";


const logger =
    createLogger(
        "AgentRegistry"
    );


// ============================================================
// Errors
// ============================================================

export class AgentRegistryError
    extends Error {

    readonly code:
        string;


    constructor(
        code: string,
        message: string
    ) {

        super(
            message
        );


        this.name =
            "AgentRegistryError";


        this.code =
            code;
    }
}


// ============================================================
// Options
// ============================================================

export interface AgentRegistryOptions {

    /*
     * If true, registering the same agentId from another bridge
     * replaces the existing record.
     *
     * V1 keeps this disabled by default so agent names remain
     * globally unambiguous.
     */

    allowBridgeTakeover?: boolean;
}


// ============================================================
// Registry
// ============================================================

export class AgentRegistry {

    private readonly agents =
        new Map<
            string,
            BrowserChatAgent
        >();


    private readonly allowBridgeTakeover:
        boolean;


    constructor(
        options:
            AgentRegistryOptions = {}
    ) {

        this.allowBridgeTakeover =
            options.allowBridgeTakeover ??
            false;
    }


    // ========================================================
    // Register
    // ========================================================

    register(
        payload: AgentRegisterPayload
    ): BrowserChatAgent {

        const agentId =
            payload.agentId.trim();


        if (
            !isValidAgentId(
                agentId
            )
        ) {

            throw new AgentRegistryError(
                ERROR_CODE.INVALID_AGENT_ID,
                `Invalid agentId: ${agentId}`
            );
        }


        const bridgeId =
            payload.bridgeId.trim();


        if (!bridgeId) {

            throw new AgentRegistryError(
                ERROR_CODE.INVALID_PAYLOAD,
                "bridgeId is required"
            );
        }


        const existing =
            this.agents.get(
                agentId
            );


        if (existing) {

            if (
                existing.bridgeId !==
                bridgeId
            ) {

                if (
                    !this.allowBridgeTakeover
                ) {

                    throw new AgentRegistryError(
                        ERROR_CODE.AGENT_ALREADY_EXISTS,
                        `Agent "${agentId}" is already registered by bridge "${existing.bridgeId}"`
                    );
                }


                logger.warn(
                    "Agent bridge takeover",
                    {
                        agentId,
                        previousBridgeId:
                            existing.bridgeId,
                        bridgeId
                    }
                );
            }


            const updated:
                BrowserChatAgent = {

                ...existing,

                provider:
                    payload.provider,

                bridgeId,

                conversationId:
                    payload.conversationId ??
                    existing.conversationId ??
                    null,

                title:
                    payload.title ??
                    existing.title ??
                    null,

                status:
                    payload.status ??
                    AGENT_STATUS.IDLE,

                capabilities:
                    normalizeCapabilities(
                        payload.capabilities ??
                        existing.capabilities
                    ),

                updatedAt:
                    now(),

                lastSeenAt:
                    now()
            };


            /*
             * Re-registration must not accidentally preserve an
             * active request from a previous bridge connection.
             */

            if (
                existing.bridgeId !==
                bridgeId
            ) {

                updated.activeRequestId =
                    null;
            }


            this.agents.set(
                agentId,
                updated
            );


            logger.info(
                "Agent re-registered",
                {
                    agentId,
                    bridgeId,
                    provider:
                        updated.provider
                }
            );


            return cloneAgent(
                updated
            );
        }


        const timestamp =
            now();


        const agent:
            BrowserChatAgent = {

            agentId,

            provider:
                payload.provider,

            bridgeId,

            conversationId:
                payload.conversationId ??
                null,

            title:
                payload.title ??
                null,

            status:
                payload.status ??
                AGENT_STATUS.IDLE,

            capabilities:
                normalizeCapabilities(
                    payload.capabilities
                ),

            activeRequestId:
                null,

            createdAt:
                timestamp,

            updatedAt:
                timestamp,

            lastSeenAt:
                timestamp
        };


        this.agents.set(
            agentId,
            agent
        );


        logger.info(
            "Agent registered",
            {
                agentId,
                bridgeId,
                provider:
                    agent.provider
            }
        );


        return cloneAgent(
            agent
        );
    }


    // ========================================================
    // Unregister
    // ========================================================

    unregister(
        agentId: string,
        bridgeId?: string
    ): BrowserChatAgent | null {

        const existing =
            this.agents.get(
                agentId
            );


        if (!existing) {

            return null;
        }


        if (
            bridgeId &&
            existing.bridgeId !==
                bridgeId
        ) {

            throw new AgentRegistryError(
                ERROR_CODE.REQUEST_MISMATCH,
                `Agent "${agentId}" does not belong to bridge "${bridgeId}"`
            );
        }


        this.agents.delete(
            agentId
        );


        logger.info(
            "Agent unregistered",
            {
                agentId,
                bridgeId:
                    existing.bridgeId
            }
        );


        return cloneAgent(
            existing
        );
    }


    // ========================================================
    // Get
    // ========================================================

    get(
        agentId: string
    ): BrowserChatAgent | null {

        const agent =
            this.agents.get(
                agentId
            );


        return agent
            ? cloneAgent(agent)
            : null;
    }


    // ========================================================
    // Require
    // ========================================================

    require(
        agentId: string
    ): BrowserChatAgent {

        const agent =
            this.agents.get(
                agentId
            );


        if (!agent) {

            throw new AgentRegistryError(
                ERROR_CODE.AGENT_NOT_FOUND,
                `Agent "${agentId}" was not found`
            );
        }


        return cloneAgent(
            agent
        );
    }


    // ========================================================
    // Has
    // ========================================================

    has(
        agentId: string
    ): boolean {

        return this.agents.has(
            agentId
        );
    }


    // ========================================================
    // List
    // ========================================================

    list(): BrowserChatAgent[] {

        return Array.from(
            this.agents.values()
        )
            .map(
                cloneAgent
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a.agentId.localeCompare(
                        b.agentId
                    )
            );
    }


    // ========================================================
    // List by bridge
    // ========================================================

    listByBridge(
        bridgeId: string
    ): BrowserChatAgent[] {

        return Array.from(
            this.agents.values()
        )
            .filter(
                (agent) =>
                    agent.bridgeId ===
                    bridgeId
            )
            .map(
                cloneAgent
            );
    }


    // ========================================================
    // Update status
    // ========================================================

    setStatus(
        agentId: string,
        status: AgentStatus,
        options: {
            requestId?: string | null;
            conversationId?: string | null;
            title?: string | null;
        } = {}
    ): BrowserChatAgent {

        const agent =
            this.getMutable(
                agentId
            );


        agent.status =
            status;


        if (
            options.requestId !==
            undefined
        ) {

            agent.activeRequestId =
                options.requestId;
        }


        if (
            options.conversationId !==
            undefined
        ) {

            agent.conversationId =
                options.conversationId;
        }


        if (
            options.title !==
            undefined
        ) {

            agent.title =
                options.title;
        }


        agent.updatedAt =
            now();

        agent.lastSeenAt =
            now();


        return cloneAgent(
            agent
        );
    }


    // ========================================================
    // Apply agent.status event
    // ========================================================

    applyStatus(
        payload: AgentStatusPayload
    ): BrowserChatAgent {

        const agent =
            this.getMutable(
                payload.agentId
            );


        if (
            payload.bridgeId &&
            agent.bridgeId !==
                payload.bridgeId
        ) {

            throw new AgentRegistryError(
                ERROR_CODE.REQUEST_MISMATCH,
                `Agent "${payload.agentId}" does not belong to bridge "${payload.bridgeId}"`
            );
        }


        agent.status =
            payload.status;


        if (
            payload.requestId !==
            undefined
        ) {

            agent.activeRequestId =
                payload.requestId;
        }


        if (
            payload.conversationId !==
            undefined
        ) {

            agent.conversationId =
                payload.conversationId;
        }


        if (
            payload.title !==
            undefined
        ) {

            agent.title =
                payload.title;
        }


        agent.updatedAt =
            now();

        agent.lastSeenAt =
            now();


        return cloneAgent(
            agent
        );
    }


    // ========================================================
    // Acquire agent
    // ========================================================

    acquire(
        agentId: string,
        requestId: string
    ): BrowserChatAgent {

        const agent =
            this.getMutable(
                agentId
            );


        if (
            agent.status ===
            AGENT_STATUS.OFFLINE
        ) {

            throw new AgentRegistryError(
                ERROR_CODE.AGENT_OFFLINE,
                `Agent "${agentId}" is offline`
            );
        }


        if (
            agent.activeRequestId &&
            agent.activeRequestId !==
                requestId
        ) {

            throw new AgentRegistryError(
                ERROR_CODE.AGENT_BUSY,
                `Agent "${agentId}" is busy`
            );
        }


        agent.activeRequestId =
            requestId;

        agent.status =
            AGENT_STATUS.SENDING;

        agent.updatedAt =
            now();


        logger.debug(
            "Agent acquired",
            {
                agentId,
                requestId,
                bridgeId:
                    agent.bridgeId
            }
        );


        return cloneAgent(
            agent
        );
    }


    // ========================================================
    // Release agent
    // ========================================================

    release(
        agentId: string,
        requestId?: string,
        nextStatus:
            AgentStatus =
                AGENT_STATUS.IDLE
    ): BrowserChatAgent {

        const agent =
            this.getMutable(
                agentId
            );


        if (
            requestId &&
            agent.activeRequestId &&
            agent.activeRequestId !==
                requestId
        ) {

            throw new AgentRegistryError(
                ERROR_CODE.REQUEST_MISMATCH,
                `Active request mismatch for agent "${agentId}"`
            );
        }


        agent.activeRequestId =
            null;

        agent.status =
            nextStatus;

        agent.updatedAt =
            now();


        logger.debug(
            "Agent released",
            {
                agentId,
                requestId,
                status:
                    nextStatus
            }
        );


        return cloneAgent(
            agent
        );
    }


    // ========================================================
    // Busy
    // ========================================================

    isBusy(
        agentId: string
    ): boolean {

        const agent =
            this.agents.get(
                agentId
            );


        if (!agent) {
            return false;
        }


        return Boolean(
            agent.activeRequestId
        );
    }


    // ========================================================
    // Touch
    // ========================================================

    touch(
        agentId: string
    ): BrowserChatAgent {

        const agent =
            this.getMutable(
                agentId
            );


        agent.lastSeenAt =
            now();

        agent.updatedAt =
            now();


        return cloneAgent(
            agent
        );
    }


    // ========================================================
    // Mark bridge offline
    // ========================================================

    markBridgeOffline(
        bridgeId: string
    ): BrowserChatAgent[] {

        const affected:
            BrowserChatAgent[] = [];


        for (
            const agent of
            this.agents.values()
        ) {

            if (
                agent.bridgeId !==
                bridgeId
            ) {
                continue;
            }


            agent.status =
                AGENT_STATUS.OFFLINE;

            agent.activeRequestId =
                null;

            agent.updatedAt =
                now();


            affected.push(
                cloneAgent(
                    agent
                )
            );
        }


        if (
            affected.length > 0
        ) {

            logger.warn(
                "Bridge agents marked offline",
                {
                    bridgeId,
                    count:
                        affected.length
                }
            );
        }


        return affected;
    }


    // ========================================================
    // Remove bridge
    // ========================================================

    removeBridge(
        bridgeId: string
    ): BrowserChatAgent[] {

        const removed:
            BrowserChatAgent[] = [];


        for (
            const [
                agentId,
                agent
            ] of this.agents
        ) {

            if (
                agent.bridgeId !==
                bridgeId
            ) {
                continue;
            }


            removed.push(
                cloneAgent(
                    agent
                )
            );


            this.agents.delete(
                agentId
            );
        }


        logger.info(
            "Bridge agents removed",
            {
                bridgeId,
                count:
                    removed.length
            }
        );


        return removed;
    }


    // ========================================================
    // Count
    // ========================================================

    count(): number {

        return this.agents.size;
    }


    // ========================================================
    // Count by bridge
    // ========================================================

    countByBridge(
        bridgeId: string
    ): number {

        let count =
            0;


        for (
            const agent of
            this.agents.values()
        ) {

            if (
                agent.bridgeId ===
                bridgeId
            ) {

                count += 1;
            }
        }


        return count;
    }


    // ========================================================
    // Clear
    // ========================================================

    clear(): void {

        this.agents.clear();


        logger.info(
            "Agent registry cleared"
        );
    }


    // ========================================================
    // Mutable lookup
    // ========================================================

    private getMutable(
        agentId: string
    ): BrowserChatAgent {

        const agent =
            this.agents.get(
                agentId
            );


        if (!agent) {

            throw new AgentRegistryError(
                ERROR_CODE.AGENT_NOT_FOUND,
                `Agent "${agentId}" was not found`
            );
        }


        return agent;
    }
}


// ============================================================
// Helpers
// ============================================================

function normalizeCapabilities(
    capabilities:
        Capability[] |
        undefined
): Capability[] {

    if (
        !Array.isArray(
            capabilities
        )
    ) {

        return [];
    }


    return Array.from(
        new Set(
            capabilities.filter(
                (
                    capability
                ): capability is Capability =>
                    typeof capability ===
                        "string" &&
                    capability.length >
                        0
            )
        )
    );
}


function cloneAgent(
    agent: BrowserChatAgent
): BrowserChatAgent {

    return {
        ...agent,

        capabilities:
            [
                ...agent.capabilities
            ]
    };
}