// browser-chat/request-queue.ts

import {
    DEFAULT_REQUEST_QUEUE_SIZE,
    ERROR_CODE,
    REQUEST_STATUS
} from "./protocol/constants";

import type {
    BrowserChatRequest
} from "./protocol/types";

import {
    createLogger
} from "./shared/logger";

import {
    now
} from "./shared/utils";


const logger =
    createLogger(
        "RequestQueue"
    );


// ============================================================
// Queue item
// ============================================================

export interface RequestQueueItem<T = unknown> {

    requestId:
        string;

    agentId:
        string;

    payload:
        T;

    status:
        typeof REQUEST_STATUS.QUEUED;

    queuedAt:
        number;

    updatedAt:
        number;
}


// ============================================================
// Queue statistics
// ============================================================

export interface RequestQueueStats {

    total:
        number;

    agents:
        number;

    maxSize:
        number;

    byAgent:
        Record<
            string,
            number
        >;
}


// ============================================================
// Options
// ============================================================

export interface RequestQueueOptions {

    /*
     * Maximum total queued requests across all agents.
     */

    maxSize?: number;


    /*
     * Optional maximum queue length for one agent.
     *
     * Defaults to the global maxSize.
     */

    maxPerAgent?: number;
}


// ============================================================
// Errors
// ============================================================

export class RequestQueueError
    extends Error {

    readonly code:
        string;

    readonly requestId?:
        string;

    readonly agentId?:
        string;


    constructor(
        code: string,
        message: string,
        options: {
            requestId?: string;
            agentId?: string;
        } = {}
    ) {

        super(
            message
        );


        this.name =
            "RequestQueueError";


        this.code =
            code;

        this.requestId =
            options.requestId;

        this.agentId =
            options.agentId;
    }
}


// ============================================================
// Request queue
// ============================================================

export class RequestQueue<
    T = unknown
> {

    /*
     * agentId -> FIFO queue
     */

    private readonly queues =
        new Map<
            string,
            RequestQueueItem<T>[]
        >();


    /*
     * requestId -> queue item
     *
     * Allows O(1) lookup for cancellation/status checks.
     */

    private readonly requests =
        new Map<
            string,
            RequestQueueItem<T>
        >();


    private readonly maxSize:
        number;


    private readonly maxPerAgent:
        number;


    constructor(
        options:
            RequestQueueOptions = {}
    ) {

        this.maxSize =
            normalizeLimit(
                options.maxSize,
                DEFAULT_REQUEST_QUEUE_SIZE
            );


        this.maxPerAgent =
            normalizeLimit(
                options.maxPerAgent,
                this.maxSize
            );
    }


    // ========================================================
    // Enqueue
    // ========================================================

    enqueue(
        requestId: string,
        agentId: string,
        payload: T
    ): RequestQueueItem<T> {

        if (
            this.requests.has(
                requestId
            )
        ) {

            throw new RequestQueueError(
                ERROR_CODE.INVALID_PAYLOAD,
                `Request "${requestId}" is already queued`,
                {
                    requestId,
                    agentId
                }
            );
        }


        if (
            this.size() >=
            this.maxSize
        ) {

            throw new RequestQueueError(
                ERROR_CODE.REQUEST_QUEUE_FULL,
                `Browser chat request queue is full (${this.maxSize})`,
                {
                    requestId,
                    agentId
                }
            );
        }


        const queue =
            this.getOrCreateQueue(
                agentId
            );


        if (
            queue.length >=
            this.maxPerAgent
        ) {

            throw new RequestQueueError(
                ERROR_CODE.REQUEST_QUEUE_FULL,
                `Queue for agent "${agentId}" is full (${this.maxPerAgent})`,
                {
                    requestId,
                    agentId
                }
            );
        }


        const timestamp =
            now();


        const item:
            RequestQueueItem<T> = {

            requestId,

            agentId,

            payload,

            status:
                REQUEST_STATUS.QUEUED,

            queuedAt:
                timestamp,

            updatedAt:
                timestamp
        };


        queue.push(
            item
        );


        this.requests.set(
            requestId,
            item
        );


        logger.debug(
            "Request queued",
            {
                requestId,
                agentId,

                position:
                    queue.length,

                queueSize:
                    this.size()
            }
        );


        return cloneItem(
            item
        );
    }


    // ========================================================
    // Dequeue
    // ========================================================

    dequeue(
        agentId: string
    ): RequestQueueItem<T> | null {

        const queue =
            this.queues.get(
                agentId
            );


        if (
            !queue ||
            queue.length === 0
        ) {

            return null;
        }


        const item =
            queue.shift();


        if (!item) {

            return null;
        }


        this.requests.delete(
            item.requestId
        );


        this.cleanupAgentQueue(
            agentId
        );


        logger.debug(
            "Request dequeued",
            {
                requestId:
                    item.requestId,

                agentId,

                queueSize:
                    this.size()
            }
        );


        return cloneItem(
            item
        );
    }


    // ========================================================
    // Peek
    // ========================================================

    peek(
        agentId: string
    ): RequestQueueItem<T> | null {

        const queue =
            this.queues.get(
                agentId
            );


        if (
            !queue ||
            queue.length === 0
        ) {

            return null;
        }


        return cloneItem(
            queue[0]
        );
    }


    // ========================================================
    // Get by request
    // ========================================================

    get(
        requestId: string
    ): RequestQueueItem<T> | null {

        const item =
            this.requests.get(
                requestId
            );


        return item
            ? cloneItem(item)
            : null;
    }


    // ========================================================
    // Has request
    // ========================================================

    has(
        requestId: string
    ): boolean {

        return this.requests.has(
            requestId
        );
    }


    // ========================================================
    // Has queued requests for agent
    // ========================================================

    hasAgent(
        agentId: string
    ): boolean {

        const queue =
            this.queues.get(
                agentId
            );


        return Boolean(
            queue &&
            queue.length > 0
        );
    }


    // ========================================================
    // Remove specific request
    // ========================================================

    remove(
        requestId: string
    ): RequestQueueItem<T> | null {

        const item =
            this.requests.get(
                requestId
            );


        if (!item) {

            return null;
        }


        const queue =
            this.queues.get(
                item.agentId
            );


        if (queue) {

            const index =
                queue.findIndex(
                    (queued) =>
                        queued.requestId ===
                        requestId
                );


            if (
                index >= 0
            ) {

                queue.splice(
                    index,
                    1
                );
            }
        }


        this.requests.delete(
            requestId
        );


        this.cleanupAgentQueue(
            item.agentId
        );


        logger.debug(
            "Queued request removed",
            {
                requestId,

                agentId:
                    item.agentId,

                queueSize:
                    this.size()
            }
        );


        return cloneItem(
            item
        );
    }


    // ========================================================
    // Remove all requests for agent
    // ========================================================

    removeAgent(
        agentId: string
    ): RequestQueueItem<T>[] {

        const queue =
            this.queues.get(
                agentId
            );


        if (!queue) {

            return [];
        }


        this.queues.delete(
            agentId
        );


        for (
            const item of queue
        ) {

            this.requests.delete(
                item.requestId
            );
        }


        logger.debug(
            "Agent queue removed",
            {
                agentId,

                count:
                    queue.length,

                queueSize:
                    this.size()
            }
        );


        return queue.map(
            cloneItem
        );
    }


    // ========================================================
    // List agent queue
    // ========================================================

    list(
        agentId: string
    ): RequestQueueItem<T>[] {

        const queue =
            this.queues.get(
                agentId
            );


        if (!queue) {

            return [];
        }


        return queue.map(
            cloneItem
        );
    }


    // ========================================================
    // List all
    // ========================================================

    listAll():
        RequestQueueItem<T>[] {

        const result:
            RequestQueueItem<T>[] = [];


        for (
            const queue of
            this.queues.values()
        ) {

            for (
                const item of queue
            ) {

                result.push(
                    cloneItem(
                        item
                    )
                );
            }
        }


        return result.sort(
            (
                a,
                b
            ) =>
                a.queuedAt -
                b.queuedAt
        );
    }


    // ========================================================
    // Queue position
    // ========================================================

    position(
        requestId: string
    ): number | null {

        const item =
            this.requests.get(
                requestId
            );


        if (!item) {

            return null;
        }


        const queue =
            this.queues.get(
                item.agentId
            );


        if (!queue) {

            return null;
        }


        const index =
            queue.findIndex(
                (queued) =>
                    queued.requestId ===
                    requestId
            );


        if (
            index < 0
        ) {

            return null;
        }


        /*
         * Human-friendly position:
         *
         * first request = 1
         */

        return index + 1;
    }


    // ========================================================
    // Agent queue size
    // ========================================================

    sizeByAgent(
        agentId: string
    ): number {

        return (
            this.queues.get(
                agentId
            )?.length ??
            0
        );
    }


    // ========================================================
    // Total size
    // ========================================================

    size(): number {

        return this.requests.size;
    }


    // ========================================================
    // Empty
    // ========================================================

    isEmpty(): boolean {

        return (
            this.requests.size ===
            0
        );
    }


    // ========================================================
    // Clear
    // ========================================================

    clear():
        RequestQueueItem<T>[] {

        const removed =
            this.listAll();


        this.queues.clear();

        this.requests.clear();


        if (
            removed.length > 0
        ) {

            logger.info(
                "Request queue cleared",
                {
                    count:
                        removed.length
                }
            );
        }


        return removed;
    }


    // ========================================================
    // Stats
    // ========================================================

    stats():
        RequestQueueStats {

        const byAgent:
            Record<
                string,
                number
            > = {};


        for (
            const [
                agentId,
                queue
            ] of this.queues
        ) {

            byAgent[agentId] =
                queue.length;
        }


        return {
            total:
                this.size(),

            agents:
                this.queues.size,

            maxSize:
                this.maxSize,

            byAgent
        };
    }


    // ========================================================
    // Convert queued item to request state
    // ========================================================

    toRequestState(
        item:
            RequestQueueItem<{
                request?:
                    BrowserChatRequest;
            }>
    ): BrowserChatRequest | null {

        const request =
            item.payload
                ?.request;


        if (!request) {

            return null;
        }


        return {
            ...request,

            status:
                REQUEST_STATUS.QUEUED,

            updatedAt:
                item.updatedAt,

            message: {
                ...request.message
            },

            ...(request.error
                ? {
                    error: {
                        ...request.error
                    }
                }
                : {})
        };
    }


    // ========================================================
    // Internal queue
    // ========================================================

    private getOrCreateQueue(
        agentId: string
    ): RequestQueueItem<T>[] {

        let queue =
            this.queues.get(
                agentId
            );


        if (!queue) {

            queue = [];


            this.queues.set(
                agentId,
                queue
            );
        }


        return queue;
    }


    // ========================================================
    // Cleanup empty agent queue
    // ========================================================

    private cleanupAgentQueue(
        agentId: string
    ): void {

        const queue =
            this.queues.get(
                agentId
            );


        if (
            queue &&
            queue.length === 0
        ) {

            this.queues.delete(
                agentId
            );
        }
    }
}


// ============================================================
// Helpers
// ============================================================

function normalizeLimit(
    value: number | undefined,
    fallback: number
): number {

    if (
        value === undefined ||
        !Number.isFinite(
            value
        )
    ) {

        return Math.max(
            1,
            Math.floor(
                fallback
            )
        );
    }


    return Math.max(
        1,
        Math.floor(
            value
        )
    );
}


function cloneItem<T>(
    item:
        RequestQueueItem<T>
): RequestQueueItem<T> {

    return {
        ...item
    };
}