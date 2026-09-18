// browser-chat/shared/utils.ts

import {
    AGENT_ID_PATTERN,
    DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_AGENT_ID_LENGTH,
    MAX_REQUEST_TIMEOUT_MS,
    MIN_REQUEST_TIMEOUT_MS
} from "../protocol/constants";


// ============================================================
// Time
// ============================================================

export function now(): number {

    return Date.now();
}


export function sleep(
    ms: number
): Promise<void> {

    const delay =
        Math.max(
            0,
            Number(ms) || 0
        );


    return new Promise(
        (resolve) => {

            setTimeout(
                resolve,
                delay
            );
        }
    );
}


// ============================================================
// ID
// ============================================================

export function generateId(
    prefix = "id"
): string {

    const timestamp =
        Date.now()
            .toString(36);


    let randomPart: string;


    if (
        typeof globalThis.crypto !== "undefined" &&
        typeof globalThis.crypto.randomUUID === "function"
    ) {

        randomPart =
            globalThis.crypto
                .randomUUID()
                .replace(/-/g, "")
                .slice(0, 12);

    } else {

        randomPart =
            Math.random()
                .toString(36)
                .slice(2, 14);
    }


    return (
        `${prefix}_${timestamp}_${randomPart}`
    );
}


// ============================================================
// Agent ID
// ============================================================

export function isValidAgentId(
    value: unknown
): value is string {

    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= MAX_AGENT_ID_LENGTH &&
        AGENT_ID_PATTERN.test(value)
    );
}


export function normalizeAgentId(
    value: string
): string {

    return String(
        value ?? ""
    ).trim();
}


// ============================================================
// Number
// ============================================================

export function clamp(
    value: number,
    min: number,
    max: number
): number {

    if (
        !Number.isFinite(value)
    ) {

        return min;
    }


    return Math.min(
        max,
        Math.max(
            min,
            value
        )
    );
}


// ============================================================
// Request timeout
// ============================================================

export function normalizeRequestTimeout(
    value?: number | null
): number {

    if (
        value === undefined ||
        value === null ||
        !Number.isFinite(value)
    ) {

        return DEFAULT_REQUEST_TIMEOUT_MS;
    }


    return Math.floor(
        clamp(
            value,
            MIN_REQUEST_TIMEOUT_MS,
            MAX_REQUEST_TIMEOUT_MS
        )
    );
}


// ============================================================
// String
// ============================================================

export function normalizeString(
    value: unknown,
    fallback = ""
): string {

    if (
        typeof value !== "string"
    ) {

        return fallback;
    }


    return value.trim();
}


export function truncate(
    value: unknown,
    maxLength = 500
): string {

    const text =
        String(
            value ?? ""
        );


    const limit =
        Math.max(
            0,
            Math.floor(
                maxLength
            )
        );


    if (
        text.length <= limit
    ) {

        return text;
    }


    if (
        limit <= 1
    ) {

        return text.slice(
            0,
            limit
        );
    }


    return (
        text.slice(
            0,
            limit - 1
        ) +
        "…"
    );
}


// ============================================================
// Object
// ============================================================

export function isPlainObject(
    value: unknown
): value is Record<
    string,
    unknown
> {

    if (
        value === null ||
        typeof value !== "object"
    ) {

        return false;
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return false;
    }


    const prototype =
        Object.getPrototypeOf(
            value
        );


    return (
        prototype === Object.prototype ||
        prototype === null
    );
}


export function compactObject<
    T extends Record<
        string,
        unknown
    >
>(
    object: T
): Partial<T> {

    const result:
        Partial<T> = {};


    for (
        const [
            key,
            value
        ] of Object.entries(
            object
        )
    ) {

        if (
            value !== undefined
        ) {

            (
                result as Record<
                    string,
                    unknown
                >
            )[key] =
                value;
        }
    }


    return result;
}


// ============================================================
// Error
// ============================================================

export function getErrorMessage(
    error: unknown,
    fallback =
        "Unknown error"
): string {

    if (
        error instanceof Error &&
        error.message
    ) {

        return error.message;
    }


    if (
        typeof error === "string" &&
        error
    ) {

        return error;
    }


    if (
        isPlainObject(
            error
        ) &&
        typeof error.message === "string"
    ) {

        return error.message;
    }


    return fallback;
}


// ============================================================
// Deferred Promise
// ============================================================

export interface Deferred<T> {

    promise:
        Promise<T>;

    resolve:
        (value: T) => void;

    reject:
        (reason?: unknown) => void;

    settled:
        boolean;
}


export function createDeferred<T>():
    Deferred<T> {

    let resolvePromise!:
        (value: T) => void;

    let rejectPromise!:
        (reason?: unknown) => void;


    let settled =
        false;


    const promise =
        new Promise<T>(
            (
                resolve,
                reject
            ) => {

                resolvePromise =
                    resolve;

                rejectPromise =
                    reject;
            }
        );


    const deferred:
        Deferred<T> = {

        promise,

        resolve(
            value: T
        ) {

            if (settled) {
                return;
            }


            settled =
                true;


            resolvePromise(
                value
            );
        },

        reject(
            reason?: unknown
        ) {

            if (settled) {
                return;
            }


            settled =
                true;


            rejectPromise(
                reason
            );
        },

        get settled() {

            return settled;
        }
    };


    return deferred;
}


// ============================================================
// Timeout error
// ============================================================

export class TimeoutError
    extends Error {

    readonly timeoutMs:
        number;


    constructor(
        message:
            string,
        timeoutMs:
            number
    ) {

        super(
            message
        );


        this.name =
            "TimeoutError";


        this.timeoutMs =
            timeoutMs;
    }
}


// ============================================================
// Promise timeout
// ============================================================

export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message =
        "Operation timed out"
): Promise<T> {

    const timeout =
        Math.max(
            0,
            Math.floor(
                Number(timeoutMs) || 0
            )
        );


    if (
        timeout === 0
    ) {

        return promise;
    }


    let timer:
        ReturnType<
            typeof setTimeout
        > | null = null;


    const timeoutPromise =
        new Promise<never>(
            (
                _resolve,
                reject
            ) => {

                timer =
                    setTimeout(
                        () => {

                            reject(
                                new TimeoutError(
                                    message,
                                    timeout
                                )
                            );

                        },
                        timeout
                    );
            }
        );


    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(
        () => {

            if (
                timer !== null
            ) {

                clearTimeout(
                    timer
                );
            }
        }
    );
}


// ============================================================
// Retry
// ============================================================

export interface RetryOptions {

    attempts?: number;

    delayMs?: number;

    backoff?: number;

    maxDelayMs?: number;

    shouldRetry?: (
        error: unknown,
        attempt: number
    ) =>
        boolean |
        Promise<boolean>;
}


export async function retry<T>(
    operation: (
        attempt: number
    ) => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {

    const maxAttempts =
        Math.max(
            1,
            Math.floor(
                options.attempts ??
                3
            )
        );


    const backoff =
        Math.max(
            1,
            options.backoff ??
            1.5
        );


    const maxDelay =
        Math.max(
            0,
            options.maxDelayMs ??
            30_000
        );


    let delay =
        Math.max(
            0,
            options.delayMs ??
            250
        );


    let lastError:
        unknown;


    for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt += 1
    ) {

        try {

            return await operation(
                attempt
            );

        } catch (error) {

            lastError =
                error;


            if (
                typeof options.shouldRetry ===
                "function"
            ) {

                const allowed =
                    await options.shouldRetry(
                        error,
                        attempt
                    );


                if (!allowed) {

                    throw error;
                }
            }


            if (
                attempt >=
                maxAttempts
            ) {

                break;
            }


            if (
                delay > 0
            ) {

                await sleep(
                    delay
                );
            }


            delay =
                Math.min(
                    maxDelay,
                    delay * backoff
                );
        }
    }


    throw lastError;
}


// ============================================================
// Safe callback
// ============================================================

export function safeCall<
    TArgs extends unknown[]
>(
    callback:
        | ((
            ...args: TArgs
        ) => void)
        | undefined
        | null,

    ...args: TArgs
): void {

    if (
        typeof callback !==
        "function"
    ) {

        return;
    }


    try {

        callback(
            ...args
        );

    } catch {

        /*
         * Intentionally ignored.
         *
         * Infrastructure callbacks should not be allowed to
         * crash BridgeManager / RequestManager.
         *
         * Callers that need diagnostics should log inside their
         * callback.
         */
    }
}


// ============================================================
// Jitter
// ============================================================

export function addJitter(
    value: number,
    ratio = 0.2
): number {

    const base =
        Math.max(
            0,
            value
        );


    const normalizedRatio =
        clamp(
            ratio,
            0,
            1
        );


    const spread =
        base *
        normalizedRatio;


    const offset =
        (
            Math.random() * 2 - 1
        ) *
        spread;


    return Math.max(
        0,
        Math.round(
            base + offset
        )
    );
}


// ============================================================
// Duration
// ============================================================

export function elapsedMs(
    startedAt: number,
    endedAt = Date.now()
): number {

    return Math.max(
        0,
        endedAt -
        startedAt
    );
}


// ============================================================
// Async cleanup helper
// ============================================================

export async function safeDispose(
    dispose:
        | (() =>
            void |
            Promise<void>)
        | undefined
        | null
): Promise<void> {

    if (
        typeof dispose !==
        "function"
    ) {

        return;
    }


    try {

        await dispose();

    } catch {

        /*
         * Cleanup failures must not hide the original failure.
         */
    }
}