// browser-chat/shared/logger.ts


// ============================================================
// Log levels
// ============================================================

export const LOG_LEVEL = {
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
    SILENT: 100
} as const;


export type LogLevel =
    typeof LOG_LEVEL[
        keyof typeof LOG_LEVEL
    ];


// ============================================================
// Types
// ============================================================

export type LogMetadata =
    Record<string, unknown>;


export interface Logger {

    debug(
        message: string,
        metadata?: LogMetadata
    ): void;

    info(
        message: string,
        metadata?: LogMetadata
    ): void;

    warn(
        message: string,
        metadata?: LogMetadata
    ): void;

    error(
        message: string,
        error?: unknown,
        metadata?: LogMetadata
    ): void;

    child(
        scope: string
    ): Logger;
}


export interface LoggerOptions {

    level?: LogLevel;

    timestamp?: boolean;
}


// ============================================================
// Global configuration
// ============================================================

let globalLevel: LogLevel =
    LOG_LEVEL.INFO;


let includeTimestamp =
    true;


// ============================================================
// Configuration
// ============================================================

export function setLogLevel(
    level: LogLevel
): void {

    if (
        !Object.values(
            LOG_LEVEL
        ).includes(level)
    ) {

        throw new Error(
            `Invalid log level: ${level}`
        );
    }


    globalLevel =
        level;
}


export function getLogLevel():
    LogLevel {

    return globalLevel;
}


export function setLogTimestamp(
    enabled: boolean
): void {

    includeTimestamp =
        Boolean(enabled);
}


// ============================================================
// Logger factory
// ============================================================

export function createLogger(
    scope: string,
    options: LoggerOptions = {}
): Logger {

    const normalizedScope =
        normalizeScope(
            scope
        );


    const localLevel =
        options.level;


    const timestamp =
        options.timestamp;


    const shouldWrite = (
        level: LogLevel
    ): boolean => {

        const effectiveLevel =
            localLevel ??
            globalLevel;


        return (
            level >=
            effectiveLevel
        );
    };


    const getPrefix = (): string => {

        const timestampEnabled =
            timestamp ??
            includeTimestamp;


        if (!timestampEnabled) {

            return (
                `[BrowserChat:${normalizedScope}]`
            );
        }


        return (
            `${new Date().toISOString()} ` +
            `[BrowserChat:${normalizedScope}]`
        );
    };


    return {

        debug(
            message,
            metadata
        ) {

            if (
                !shouldWrite(
                    LOG_LEVEL.DEBUG
                )
            ) {
                return;
            }


            write(
                "debug",
                getPrefix(),
                message,
                metadata
            );
        },


        info(
            message,
            metadata
        ) {

            if (
                !shouldWrite(
                    LOG_LEVEL.INFO
                )
            ) {
                return;
            }


            write(
                "info",
                getPrefix(),
                message,
                metadata
            );
        },


        warn(
            message,
            metadata
        ) {

            if (
                !shouldWrite(
                    LOG_LEVEL.WARN
                )
            ) {
                return;
            }


            write(
                "warn",
                getPrefix(),
                message,
                metadata
            );
        },


        error(
            message,
            error,
            metadata
        ) {

            if (
                !shouldWrite(
                    LOG_LEVEL.ERROR
                )
            ) {
                return;
            }


            const normalizedError =
                normalizeError(
                    error
                );


            write(
                "error",
                getPrefix(),
                message,
                {
                    ...(metadata ?? {}),

                    ...(normalizedError
                        ? {
                            error:
                                normalizedError
                        }
                        : {})
                }
            );
        },


        child(
            childScope
        ) {

            return createLogger(
                `${normalizedScope}:${normalizeScope(childScope)}`,
                {
                    level:
                        localLevel,

                    timestamp
                }
            );
        }
    };
}


// ============================================================
// Console writer
// ============================================================

function write(
    method:
        | "debug"
        | "info"
        | "warn"
        | "error",
    prefix: string,
    message: string,
    metadata?: LogMetadata
): void {

    const safeMetadata =
        metadata
            ? sanitizeMetadata(
                metadata
            )
            : undefined;


    if (
        safeMetadata &&
        Object.keys(
            safeMetadata
        ).length > 0
    ) {

        console[method](
            prefix,
            message,
            safeMetadata
        );


        return;
    }


    console[method](
        prefix,
        message
    );
}


// ============================================================
// Metadata sanitization
// ============================================================

const SENSITIVE_KEYS =
    new Set([
        "token",
        "bridgetoken",
        "bridge_token",

        "authorization",
        "cookie",
        "cookies",

        "password",
        "secret",

        "prompt",
        "content",
        "response",
        "messagecontent"
    ]);


function sanitizeMetadata(
    metadata: LogMetadata
): LogMetadata {

    const result:
        LogMetadata = {};


    for (
        const [
            key,
            value
        ] of Object.entries(
            metadata
        )
    ) {

        const normalizedKey =
            key
                .toLowerCase()
                .replace(
                    /[^a-z0-9_]/g,
                    ""
                );


        if (
            SENSITIVE_KEYS.has(
                normalizedKey
            )
        ) {

            result[key] =
                "[REDACTED]";


            continue;
        }


        result[key] =
            sanitizeValue(
                value,
                0
            );
    }


    return result;
}


// ============================================================
// Recursive sanitization
// ============================================================

function sanitizeValue(
    value: unknown,
    depth: number
): unknown {

    if (
        depth > 4
    ) {
        return "[MAX_DEPTH]";
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return value.map(
            (item) =>
                sanitizeValue(
                    item,
                    depth + 1
                )
        );
    }


    if (
        value &&
        typeof value === "object"
    ) {

        if (
            value instanceof Error
        ) {

            return normalizeError(
                value
            );
        }


        const object =
            value as Record<
                string,
                unknown
            >;


        const result:
            Record<
                string,
                unknown
            > = {};


        for (
            const [
                key,
                nestedValue
            ] of Object.entries(
                object
            )
        ) {

            const normalizedKey =
                key
                    .toLowerCase()
                    .replace(
                        /[^a-z0-9_]/g,
                        ""
                    );


            if (
                SENSITIVE_KEYS.has(
                    normalizedKey
                )
            ) {

                result[key] =
                    "[REDACTED]";


                continue;
            }


            result[key] =
                sanitizeValue(
                    nestedValue,
                    depth + 1
                );
        }


        return result;
    }


    if (
        typeof value === "string" &&
        value.length > 1000
    ) {

        return (
            value.slice(
                0,
                1000
            ) +
            "…[TRUNCATED]"
        );
    }


    return value;
}


// ============================================================
// Error normalization
// ============================================================

function normalizeError(
    error: unknown
): Record<
    string,
    unknown
> | null {

    if (
        error === undefined ||
        error === null
    ) {

        return null;
    }


    if (
        error instanceof Error
    ) {

        return {
            name:
                error.name,

            message:
                error.message,

            ...(error.stack
                ? {
                    stack:
                        error.stack
                }
                : {})
        };
    }


    if (
        typeof error === "string"
    ) {

        return {
            message:
                error
        };
    }


    if (
        typeof error === "object"
    ) {

        return sanitizeValue(
            error,
            0
        ) as Record<
            string,
            unknown
        >;
    }


    return {
        message:
            String(error)
    };
}


// ============================================================
// Scope
// ============================================================

function normalizeScope(
    scope: string
): string {

    if (
        typeof scope !== "string"
    ) {

        return "Unknown";
    }


    const normalized =
        scope.trim();


    return (
        normalized ||
        "Unknown"
    );
}