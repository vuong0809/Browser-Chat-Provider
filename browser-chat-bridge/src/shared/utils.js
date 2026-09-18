// src/shared/utils.js


// ============================================================
// Time
// ============================================================

export function now() {
    return Date.now();
}


export function sleep(
    ms
) {

    return new Promise(
        (resolve) => {
            setTimeout(
                resolve,
                Math.max(
                    0,
                    Number(ms) || 0
                )
            );
        }
    );
}


// ============================================================
// ID
// ============================================================

export function randomId(
    prefix = "id"
) {

    const time =
        Date.now()
            .toString(36);


    let random;


    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {

        random =
            crypto.randomUUID()
                .replaceAll("-", "")
                .slice(0, 12);

    } else {

        random =
            Math.random()
                .toString(36)
                .slice(2, 14);
    }


    return `${prefix}_${time}_${random}`;
}


// ============================================================
// String
// ============================================================

export function normalizeString(
    value,
    fallback = ""
) {

    if (
        typeof value !== "string"
    ) {
        return fallback;
    }


    return value.trim();
}


export function truncate(
    value,
    maxLength = 120
) {

    const text =
        String(
            value ?? ""
        );


    const limit =
        Math.max(
            0,
            Number(maxLength) || 0
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
// Agent ID
// ============================================================

export function isValidAgentId(
    value
) {

    return (
        typeof value === "string" &&
        /^[a-zA-Z0-9_-]+$/.test(
            value
        )
    );
}


export function normalizeAgentId(
    value
) {

    return normalizeString(
        value
    );
}


// ============================================================
// URL
// ============================================================

export function safeParseUrl(
    value
) {

    if (
        typeof value !== "string" ||
        !value
    ) {
        return null;
    }


    try {

        return new URL(
            value
        );

    } catch {

        return null;
    }
}


export function isChatGPTUrl(
    value
) {

    const url =
        safeParseUrl(
            value
        );


    if (!url) {
        return false;
    }


    return (
        url.protocol === "https:" &&
        url.hostname === "chatgpt.com"
    );
}


export function getChatGPTConversationId(
    value
) {

    const url =
        safeParseUrl(
            value
        );


    if (!url) {
        return null;
    }


    if (
        url.hostname !== "chatgpt.com"
    ) {
        return null;
    }


    const match =
        url.pathname.match(
            /^\/c\/([^/?#]+)/
        );


    return (
        match?.[1] ??
        null
    );
}


// ============================================================
// Number
// ============================================================

export function clamp(
    value,
    min,
    max
) {

    const number =
        Number(value);


    if (
        !Number.isFinite(number)
    ) {
        return min;
    }


    return Math.min(
        max,
        Math.max(
            min,
            number
        )
    );
}


export function toPositiveInteger(
    value,
    fallback = 0
) {

    const number =
        Number(value);


    if (
        !Number.isFinite(number)
    ) {
        return fallback;
    }


    const integer =
        Math.floor(number);


    return (
        integer >= 0
            ? integer
            : fallback
    );
}


// ============================================================
// Object
// ============================================================

export function isPlainObject(
    value
) {

    if (
        value === null ||
        typeof value !== "object"
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


export function compactObject(
    object
) {

    if (
        !isPlainObject(object)
    ) {
        return {};
    }


    return Object.fromEntries(
        Object.entries(object)
            .filter(
                ([, value]) =>
                    value !== undefined
            )
    );
}


// ============================================================
// Error
// ============================================================

export function getErrorMessage(
    error,
    fallback = "Unknown error"
) {

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
        error &&
        typeof error.message === "string"
    ) {
        return error.message;
    }


    return fallback;
}


// ============================================================
// Promise timeout
// ============================================================

export function withTimeout(
    promise,
    timeoutMs,
    message = "Operation timed out"
) {

    const timeout =
        Math.max(
            0,
            Number(timeoutMs) || 0
        );


    if (!timeout) {
        return promise;
    }


    let timer;


    const timeoutPromise =
        new Promise(
            (
                _resolve,
                reject
            ) => {

                timer =
                    setTimeout(
                        () => {

                            reject(
                                new Error(
                                    message
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

            if (timer) {
                clearTimeout(
                    timer
                );
            }
        }
    );
}


// ============================================================
// Async retry
// ============================================================

export async function retry(
    operation,
    options = {}
) {

    const {
        attempts = 3,
        delayMs = 250,
        backoff = 1.5,
        shouldRetry = null
    } = options;


    const maxAttempts =
        Math.max(
            1,
            Number(attempts) || 1
        );


    let delay =
        Math.max(
            0,
            Number(delayMs) || 0
        );


    let lastError;


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
                typeof shouldRetry === "function"
            ) {

                const allowed =
                    await shouldRetry(
                        error,
                        attempt
                    );


                if (!allowed) {
                    throw error;
                }
            }


            if (
                attempt >= maxAttempts
            ) {
                break;
            }


            if (delay > 0) {

                await sleep(
                    delay
                );
            }


            delay *=
                Number(backoff) || 1;
        }
    }


    throw lastError;
}


// ============================================================
// Safe callback
// ============================================================

export function safeCall(
    callback,
    ...args
) {

    if (
        typeof callback !== "function"
    ) {
        return undefined;
    }


    try {

        return callback(
            ...args
        );

    } catch (error) {

        console.error(
            "[Utils] Callback failed:",
            error
        );


        return undefined;
    }
}