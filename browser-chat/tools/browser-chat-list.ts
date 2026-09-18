// browser-chat/tools/browser-chat-list.ts

import {
    AGENT_STATUS
} from "../protocol/constants";

import type {
    AgentStatus,
    BrowserChatAgent,
    BrowserChatListResult,
    Capability,
    ProviderId
} from "../protocol/types";

import {
    AgentRegistry
} from "../agent-registry";

import {
    createLogger
} from "../shared/logger";


const logger =
    createLogger(
        "Tool:BrowserChatList"
    );


// ============================================================
// Public tool result
// ============================================================

/*
 * Keep the Codex-facing representation smaller than the
 * internal BrowserChatAgent record.
 *
 * In particular, Codex does not need tabId.
 */

export interface BrowserChatListAgent {

    agentId:
        string;

    provider:
        ProviderId;

    status:
        AgentStatus;

    ready:
        boolean;

    busy:
        boolean;

    conversationId:
        string | null;

    title:
        string | null;

    capabilities:
        Capability[];

    activeRequestId:
        string | null;
}


export interface BrowserChatListToolResult {

    agents:
        BrowserChatListAgent[];

    count:
        number;

    available:
        number;

    busy:
        number;

    offline:
        number;
}


// ============================================================
// Tool options
// ============================================================

export interface BrowserChatListToolOptions {

    agentRegistry:
        AgentRegistry;
}


// ============================================================
// Tool
// ============================================================

export class BrowserChatListTool {

    readonly name =
        "browser_chat_list";


    readonly description =
        "List browser chat agents registered through the local browser bridge, including provider and availability status.";


    private readonly agentRegistry:
        AgentRegistry;


    constructor(
        options:
            BrowserChatListToolOptions
    ) {

        this.agentRegistry =
            options.agentRegistry;
    }


    // ========================================================
    // Execute
    // ========================================================

    async execute():
        Promise<
            BrowserChatListToolResult
        > {

        const agents =
            this.agentRegistry
                .list()
                .map(
                    toPublicAgent
                );


        const available =
            agents.filter(
                (agent) =>
                    agent.ready
            ).length;


        const busy =
            agents.filter(
                (agent) =>
                    agent.busy
            ).length;


        const offline =
            agents.filter(
                (agent) =>
                    agent.status ===
                    AGENT_STATUS.OFFLINE
            ).length;


        logger.debug(
            "Browser chat agents listed",
            {
                count:
                    agents.length,

                available,

                busy,

                offline
            }
        );


        return {
            agents,

            count:
                agents.length,

            available,

            busy,

            offline
        };
    }
}


// ============================================================
// Functional API
// ============================================================

/*
 * Some 9Router tool registries may prefer a plain function
 * instead of a class instance.
 */

export async function browserChatList(
    agentRegistry:
        AgentRegistry
): Promise<
    BrowserChatListToolResult
> {

    const tool =
        new BrowserChatListTool({
            agentRegistry
        });


    return tool.execute();
}


// ============================================================
// Tool definition
// ============================================================

/*
 * Generic JSON-schema-like definition.
 *
 * File 37 (index.ts) can adapt this object to the exact 9Router
 * tool registration API without coupling this module to Codex,
 * OpenAI, MCP, or another provider.
 */

export const browserChatListToolDefinition = {

    name:
        "browser_chat_list",

    description:
        "List browser chat agents registered through the local browser bridge and show whether each agent is available, busy, or offline.",

    inputSchema: {
        type:
            "object",

        properties: {},

        additionalProperties:
            false
    }
} as const;


// ============================================================
// Mapping
// ============================================================

function toPublicAgent(
    agent:
        BrowserChatAgent
): BrowserChatListAgent {

    const busy =
        Boolean(
            agent.activeRequestId
        ) ||
        agent.status ===
            AGENT_STATUS.SENDING ||
        agent.status ===
            AGENT_STATUS.GENERATING;


    const ready =
        agent.status !==
            AGENT_STATUS.OFFLINE &&
        agent.status !==
            AGENT_STATUS.ERROR &&
        !busy;


    return {

        agentId:
            agent.agentId,

        provider:
            agent.provider,

        status:
            agent.status,

        ready,

        busy,

        conversationId:
            agent.conversationId ??
            null,

        title:
            agent.title ??
            null,

        capabilities:
            [
                ...agent.capabilities
            ],

        activeRequestId:
            agent.activeRequestId ??
            null
    };
}