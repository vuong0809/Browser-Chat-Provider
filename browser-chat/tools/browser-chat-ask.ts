// browser-chat/tools/browser-chat-ask.ts

import {
    CAPABILITY,
    DEFAULT_REQUEST_TIMEOUT_MS,
    ERROR_CODE,
    MAX_MESSAGE_LENGTH,
    MAX_REQUEST_TIMEOUT_MS,
    MIN_REQUEST_TIMEOUT_MS
} from "../protocol/constants";

import type {
    BrowserChatAskResult
} from "../protocol/types";

import {
    AgentRegistry
} from "../agent-registry";

import {
    BrowserChatRequestError,
    RequestManager
} from "../request-manager";

import {
    createLogger
} from "../shared/logger";

import {
    getErrorMessage,
    normalizeAgentId,
    normalizeRequestTimeout
} from "../shared/utils";


const logger =
    createLogger(
        "Tool:BrowserChatAsk"
    );


// ============================================================
// Input
// ============================================================

export interface BrowserChatAskInput {

    /*
     * Logical browser chat agent name.
     *
     * Examples:
     *
     * architect
     * reviewer
     * researcher
     */

    agent:
        string;

    /*
     * Prompt sent to the existing browser conversation.
     */

    prompt:
        string;

    /*
     * Keep streaming enabled between Extension and Browser Chat Provider.
     *
     * The Codex tool itself still resolves when the browser
     * response is complete.
     */

    stream?:
        boolean;

    /*
     * Optional request timeout.
     */

    timeoutMs?:
        number;
}


// ============================================================
// Output
// ============================================================

export interface BrowserChatAskToolResult {

    requestId:
        string;

    agentId:
        string;

    status:
        BrowserChatAskResult["status"];

    content:
        string;

    conversationId:
        string | null;

    durationMs:
        number | null;
}


// ============================================================
// Options
// ============================================================

export interface BrowserChatAskToolOptions {

    requestManager:
        RequestManager;

    agentRegistry:
        AgentRegistry;
}


// ============================================================
// Tool
// ============================================================

export class BrowserChatAskTool {

    readonly name =
        "browser_chat_ask";


    readonly description =
        "Send a prompt to a registered browser chat agent and wait for the response from that browser conversation.";


    private readonly requestManager:
        RequestManager;


    private readonly agentRegistry:
        AgentRegistry;


    constructor(
        options:
            BrowserChatAskToolOptions
    ) {

        this.requestManager =
            options.requestManager;

        this.agentRegistry =
            options.agentRegistry;
    }


    // ========================================================
    // Execute
    // ========================================================

    async execute(
        input:
            BrowserChatAskInput
    ): Promise<
        BrowserChatAskToolResult
    > {

        const normalized =
            validateAndNormalizeInput(
                input
            );


        const agent =
            this.agentRegistry.get(
                normalized.agent
            );


        if (!agent) {

            throw new BrowserChatRequestError(
                ERROR_CODE.AGENT_NOT_FOUND,
                `Browser chat agent "${normalized.agent}" was not found`,
                {
                    agentId:
                        normalized.agent
                }
            );
        }


        /*
         * V1 browser_chat_ask requires text support.
         */

        if (
            !agent.capabilities.includes(
                CAPABILITY.TEXT
            )
        ) {

            throw new BrowserChatRequestError(
                ERROR_CODE.INVALID_PAYLOAD,
                `Browser chat agent "${normalized.agent}" does not support text messages`,
                {
                    agentId:
                        normalized.agent
                }
            );
        }


        /*
         * If caller explicitly requests streaming, make sure the
         * provider advertised that capability.
         */

        if (
            normalized.stream ===
                true &&
            !agent.capabilities.includes(
                CAPABILITY.STREAM
            )
        ) {

            throw new BrowserChatRequestError(
                ERROR_CODE.INVALID_PAYLOAD,
                `Browser chat agent "${normalized.agent}" does not support streaming`,
                {
                    agentId:
                        normalized.agent
                }
            );
        }


        logger.info(
            "Browser chat tool request started",
            {
                agentId:
                    normalized.agent,

                stream:
                    normalized.stream,

                timeoutMs:
                    normalized.timeoutMs,

                /*
                 * Do not log prompt content.
                 */

                promptLength:
                    normalized.prompt.length
            }
        );


        const startedAt =
            Date.now();


        try {

            const result =
                await this.requestManager.ask(
                    normalized.agent,
                    normalized.prompt,
                    {
                        stream:
                            normalized.stream,

                        timeoutMs:
                            normalized.timeoutMs
                    }
                );


            const output:
                BrowserChatAskToolResult = {

                requestId:
                    result.requestId,

                agentId:
                    result.agentId,

                status:
                    result.status,

                content:
                    result.content,

                conversationId:
                    result.conversationId ??
                    null,

                durationMs:
                    result.durationMs ??
                    (
                        Date.now() -
                        startedAt
                    )
            };


            logger.info(
                "Browser chat tool request completed",
                {
                    requestId:
                        output.requestId,

                    agentId:
                        output.agentId,

                    status:
                        output.status,

                    durationMs:
                        output.durationMs,

                    /*
                     * Response content is intentionally not
                     * logged.
                     */

                    responseLength:
                        output.content.length
                }
            );


            return output;

        } catch (error) {

            logger.error(
                "Browser chat tool request failed",
                error,
                {
                    agentId:
                        normalized.agent,

                    durationMs:
                        Date.now() -
                        startedAt
                }
            );


            throw normalizeToolError(
                error,
                normalized.agent
            );
        }
    }
}


// ============================================================
// Functional API
// ============================================================

export async function browserChatAsk(
    requestManager:
        RequestManager,
    agentRegistry:
        AgentRegistry,
    input:
        BrowserChatAskInput
): Promise<
    BrowserChatAskToolResult
> {

    const tool =
        new BrowserChatAskTool({
            requestManager,
            agentRegistry
        });


    return tool.execute(
        input
    );
}


// ============================================================
// Tool definition
// ============================================================

/*
 * Generic tool schema.
 *
 * File 37 can adapt this definition to the actual host
 * registration API.
 */

export const browserChatAskToolDefinition = {

    name:
        "browser_chat_ask",

    description:
        "Send a prompt to a named browser chat agent such as architect, reviewer, or researcher, and wait for the response from its existing browser conversation.",

    inputSchema: {

        type:
            "object",

        properties: {

            agent: {
                type:
                    "string",

                description:
                    "Registered browser chat agent name, for example architect, reviewer, or researcher."
            },

            prompt: {
                type:
                    "string",

                description:
                    "Prompt to send to the browser chat conversation.",

                minLength:
                    1,

                maxLength:
                    MAX_MESSAGE_LENGTH
            },

            stream: {
                type:
                    "boolean",

                description:
                    "Enable streaming between the browser bridge and Browser Chat Provider while waiting for completion.",

                default:
                    true
            },

            timeoutMs: {
                type:
                    "integer",

                description:
                    "Maximum time to wait for the browser chat response in milliseconds.",

                minimum:
                    MIN_REQUEST_TIMEOUT_MS,

                maximum:
                    MAX_REQUEST_TIMEOUT_MS,

                default:
                    DEFAULT_REQUEST_TIMEOUT_MS
            }
        },

        required: [
            "agent",
            "prompt"
        ],

        additionalProperties:
            false
    }
} as const;


// ============================================================
// Validation
// ============================================================

function validateAndNormalizeInput(
    input:
        BrowserChatAskInput
): Required<
    Pick<
        BrowserChatAskInput,
        | "agent"
        | "prompt"
        | "stream"
        | "timeoutMs"
    >
> {

    if (
        !input ||
        typeof input !==
            "object"
    ) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            "browser_chat_ask input must be an object"
        );
    }


    const agent =
        normalizeAgentId(
            input.agent
        );


    if (!agent) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_AGENT_ID,
            "Browser chat agent is required"
        );
    }


    if (
        typeof input.prompt !==
        "string"
    ) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            "Browser chat prompt must be a string",
            {
                agentId:
                    agent
            }
        );
    }


    const prompt =
        input.prompt.trim();


    if (!prompt) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            "Browser chat prompt must not be empty",
            {
                agentId:
                    agent
            }
        );
    }


    if (
        prompt.length >
        MAX_MESSAGE_LENGTH
    ) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            `Browser chat prompt exceeds ${MAX_MESSAGE_LENGTH} characters`,
            {
                agentId:
                    agent
            }
        );
    }


    if (
        input.stream !== undefined &&
        typeof input.stream !==
            "boolean"
    ) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            "stream must be boolean",
            {
                agentId:
                    agent
            }
        );
    }


    if (
        input.timeoutMs !== undefined &&
        (
            typeof input.timeoutMs !==
                "number" ||
            !Number.isFinite(
                input.timeoutMs
            )
        )
    ) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            "timeoutMs must be a finite number",
            {
                agentId:
                    agent
            }
        );
    }


    return {

        agent,

        prompt,

        stream:
            input.stream ??
            true,

        timeoutMs:
            normalizeRequestTimeout(
                input.timeoutMs
            )
    };
}


// ============================================================
// Error normalization
// ============================================================

function normalizeToolError(
    error: unknown,
    agentId: string
): BrowserChatRequestError {

    if (
        error instanceof
        BrowserChatRequestError
    ) {

        return error;
    }


    if (
        error &&
        typeof error ===
            "object" &&
        "code" in error &&
        typeof (
            error as {
                code?: unknown;
            }
        ).code ===
            "string"
    ) {

        return new BrowserChatRequestError(
            (
                error as {
                    code: string;
                }
            ).code,

            getErrorMessage(
                error
            ),

            {
                agentId
            }
        );
    }


    return new BrowserChatRequestError(
        ERROR_CODE.INTERNAL_ERROR,
        getErrorMessage(
            error,
            "browser_chat_ask failed"
        ),
        {
            agentId
        }
    );
}
