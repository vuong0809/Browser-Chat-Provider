// browser-chat/tools/browser-chat-cancel.ts

import {
    ERROR_CODE
} from "../protocol/constants";

import {
    BrowserChatRequestError,
    RequestManager
} from "../request-manager";

import {
    createLogger
} from "../shared/logger";

import {
    getErrorMessage
} from "../shared/utils";


const logger =
    createLogger(
        "Tool:BrowserChatCancel"
    );


// ============================================================
// Input
// ============================================================

export interface BrowserChatCancelInput {

    /*
     * Request ID returned by browser_chat_ask / RequestManager.
     *
     * Example:
     *
     * req_mabc123_xyz456
     */

    requestId:
        string;
}


// ============================================================
// Output
// ============================================================

export interface BrowserChatCancelToolResult {

    requestId:
        string;

    canceled:
        boolean;

    agentId:
        string | null;

    message:
        string;
}


// ============================================================
// Options
// ============================================================

export interface BrowserChatCancelToolOptions {

    requestManager:
        RequestManager;
}


// ============================================================
// Tool
// ============================================================

export class BrowserChatCancelTool {

    readonly name =
        "browser_chat_cancel";


    readonly description =
        "Cancel an active browser chat request by request ID.";


    private readonly requestManager:
        RequestManager;


    constructor(
        options:
            BrowserChatCancelToolOptions
    ) {

        this.requestManager =
            options.requestManager;
    }


    // ========================================================
    // Execute
    // ========================================================

    async execute(
        input:
            BrowserChatCancelInput
    ): Promise<
        BrowserChatCancelToolResult
    > {

        const requestId =
            validateRequestId(
                input
            );


        /*
         * Capture request metadata before cancel(), because
         * RequestManager removes the runtime request after a
         * successful cancellation.
         */

        const request =
            this.requestManager.get(
                requestId
            );


        if (!request) {

            throw new BrowserChatRequestError(
                ERROR_CODE.REQUEST_NOT_FOUND,
                `Browser chat request "${requestId}" was not found`,
                {
                    requestId
                }
            );
        }


        logger.info(
            "Browser chat cancellation requested",
            {
                requestId,

                agentId:
                    request.agentId,

                status:
                    request.status
            }
        );


        try {

            const canceled =
                await this.requestManager
                    .cancel(
                        requestId
                    );


            const result:
                BrowserChatCancelToolResult = {

                requestId,

                canceled,

                agentId:
                    request.agentId ??
                    null,

                message:
                    canceled
                        ? "Browser chat request canceled"
                        : "Browser chat request was already completed"
            };


            logger.info(
                "Browser chat cancellation completed",
                {
                    requestId,

                    agentId:
                        result.agentId,

                    canceled
                }
            );


            return result;

        } catch (error) {

            logger.error(
                "Browser chat cancellation failed",
                error,
                {
                    requestId,

                    agentId:
                        request.agentId
                }
            );


            throw normalizeCancelError(
                error,
                requestId,
                request.agentId
            );
        }
    }
}


// ============================================================
// Functional API
// ============================================================

export async function browserChatCancel(
    requestManager:
        RequestManager,
    input:
        BrowserChatCancelInput
): Promise<
    BrowserChatCancelToolResult
> {

    const tool =
        new BrowserChatCancelTool({
            requestManager
        });


    return tool.execute(
        input
    );
}


// ============================================================
// Tool definition
// ============================================================

export const browserChatCancelToolDefinition = {

    name:
        "browser_chat_cancel",

    description:
        "Cancel an active browser chat request using the request ID returned by the browser chat system.",

    inputSchema: {

        type:
            "object",

        properties: {

            requestId: {

                type:
                    "string",

                description:
                    "ID of the active browser chat request to cancel.",

                minLength:
                    1
            }
        },

        required: [
            "requestId"
        ],

        additionalProperties:
            false
    }
} as const;


// ============================================================
// Validation
// ============================================================

function validateRequestId(
    input:
        BrowserChatCancelInput
): string {

    if (
        !input ||
        typeof input !==
            "object"
    ) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            "browser_chat_cancel input must be an object"
        );
    }


    if (
        typeof input.requestId !==
        "string"
    ) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            "requestId must be a string"
        );
    }


    const requestId =
        input.requestId.trim();


    if (!requestId) {

        throw new BrowserChatRequestError(
            ERROR_CODE.INVALID_PAYLOAD,
            "requestId must not be empty"
        );
    }


    return requestId;
}


// ============================================================
// Error normalization
// ============================================================

function normalizeCancelError(
    error: unknown,
    requestId: string,
    agentId?: string
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
        "code" in error
    ) {

        const code =
            (
                error as {
                    code?: unknown;
                }
            ).code;


        if (
            typeof code ===
                "string"
        ) {

            return new BrowserChatRequestError(
                code,
                getErrorMessage(
                    error
                ),
                {
                    requestId,
                    agentId
                }
            );
        }
    }


    return new BrowserChatRequestError(
        ERROR_CODE.INTERNAL_ERROR,
        getErrorMessage(
            error,
            "browser_chat_cancel failed"
        ),
        {
            requestId,
            agentId
        }
    );
}