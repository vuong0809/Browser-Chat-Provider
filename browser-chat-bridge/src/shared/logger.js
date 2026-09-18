// src/shared/logger.js

const LOG_LEVEL = Object.freeze({
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
    SILENT: 100
});


const LOG_LEVEL_NAME = Object.freeze({
    10: "DEBUG",
    20: "INFO",
    30: "WARN",
    40: "ERROR"
});


let currentLevel =
    LOG_LEVEL.DEBUG;


/**
 * Change global log level.
 *
 * Example:
 *
 * setLogLevel(LOG_LEVEL.INFO);
 */
export function setLogLevel(
    level
) {

    if (
        !Object.values(LOG_LEVEL)
            .includes(level)
    ) {

        throw new Error(
            `Invalid log level: ${level}`
        );
    }


    currentLevel =
        level;
}


/**
 * Return current global log level.
 */
export function getLogLevel() {

    return currentLevel;
}


/**
 * Create a scoped logger.
 *
 * Example:
 *
 * const logger =
 *     createLogger("ServiceWorker");
 *
 * logger.info("Started");
 */
export function createLogger(
    scope
) {

    const normalizedScope =
        normalizeScope(scope);


    return {

        debug(
            message,
            ...args
        ) {

            writeLog(
                LOG_LEVEL.DEBUG,
                normalizedScope,
                message,
                args
            );
        },


        info(
            message,
            ...args
        ) {

            writeLog(
                LOG_LEVEL.INFO,
                normalizedScope,
                message,
                args
            );
        },


        warn(
            message,
            ...args
        ) {

            writeLog(
                LOG_LEVEL.WARN,
                normalizedScope,
                message,
                args
            );
        },


        error(
            message,
            ...args
        ) {

            writeLog(
                LOG_LEVEL.ERROR,
                normalizedScope,
                message,
                args
            );
        },


        child(
            childScope
        ) {

            return createLogger(
                `${normalizedScope}:${normalizeScope(childScope)}`
            );
        }
    };
}


/**
 * Internal log writer.
 */
function writeLog(
    level,
    scope,
    message,
    args
) {

    if (
        level <
        currentLevel
    ) {
        return;
    }


    const prefix =
        `[${scope}]`;


    const output =
        normalizeMessage(
            message
        );


    switch (level) {

        case LOG_LEVEL.DEBUG:

            console.debug(
                prefix,
                output,
                ...args
            );

            break;


        case LOG_LEVEL.INFO:

            console.info(
                prefix,
                output,
                ...args
            );

            break;


        case LOG_LEVEL.WARN:

            console.warn(
                prefix,
                output,
                ...args
            );

            break;


        case LOG_LEVEL.ERROR:

            console.error(
                prefix,
                output,
                ...args
            );

            break;


        default:

            console.log(
                prefix,
                output,
                ...args
            );
    }
}


/**
 * Normalize logger scope.
 */
function normalizeScope(
    scope
) {

    if (
        typeof scope !== "string"
    ) {
        return "BrowserChatBridge";
    }


    const value =
        scope.trim();


    return (
        value ||
        "BrowserChatBridge"
    );
}


/**
 * Normalize common message types.
 */
function normalizeMessage(
    message
) {

    if (
        message instanceof Error
    ) {

        return (
            message.stack ||
            message.message ||
            String(message)
        );
    }


    if (
        message === undefined
    ) {
        return "";
    }


    return message;
}


/**
 * Export levels so individual environments can configure them.
 */
export {
    LOG_LEVEL,
    LOG_LEVEL_NAME
};