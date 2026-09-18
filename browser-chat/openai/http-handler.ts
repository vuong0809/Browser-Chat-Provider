// openai/http-handler.ts
//
// HTTP layer for Browser Chat OpenAI compatibility.
//
// Supported endpoints:
//
//   GET  /browser-chat-openai/v1/models
//   POST /browser-chat-openai/v1/chat/completions
//
// V1.1:
// - stream:false -> normal OpenAI JSON response
// - stream:true  -> OpenAI-compatible buffered SSE
//
// IMPORTANT:
//
// Browser Chat itself is still buffered.
// The full ChatGPT Web response is collected first.
// If stream:true was requested, this handler converts that
// completed response into OpenAI chat.completion.chunk events.

import type {
  IncomingMessage,
  ServerResponse
} from "node:http";

import {
  BrowserChatOpenAIAdapter,
  type OpenAIChatCompletionRequest,
  type OpenAIChatCompletionResponse
} from "./adapter";


// ============================================================
// Constants
// ============================================================

export const BROWSER_CHAT_OPENAI_BASE_PATH =
  "/browser-chat-openai/v1";

export const BROWSER_CHAT_OPENAI_MODELS_PATH =
  `${BROWSER_CHAT_OPENAI_BASE_PATH}/models`;

export const BROWSER_CHAT_OPENAI_CHAT_COMPLETIONS_PATH =
  `${BROWSER_CHAT_OPENAI_BASE_PATH}/chat/completions`;

const DEFAULT_MAX_BODY_BYTES =
  2 * 1024 * 1024;


// ============================================================
// Types
// ============================================================

export interface BrowserChatOpenAIHttpHandlerOptions {
  /**
   * Maximum accepted JSON body size.
   *
   * Default: 2 MB
   */
  maxBodyBytes?: number;
}

export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}



interface OpenAIChatCompletionChunk {
  id: string;

  object:
  "chat.completion.chunk";

  created:
  number;

  model:
  string;

  choices: Array<{
    index:
    number;

    delta: {
      role?:
      "assistant";

      content?:
      string;

      tool_calls?:
      Array<{
        index:
        number;

        id?:
        string;

        type?:
        "function";

        function?: {
          name?:
          string;

          arguments?:
          string;
        };
      }>;
    };

    finish_reason:
    | "stop"
    | "tool_calls"
    | null;
  }>;
}


// ============================================================
// Helpers
// ============================================================

function getRequestPath(
  req: IncomingMessage
): string {
  const rawUrl =
    req.url || "/";

  try {
    return new URL(
      rawUrl,
      "http://127.0.0.1"
    ).pathname;
  } catch {
    return rawUrl.split("?")[0] || "/";
  }
}


function setCommonHeaders(
  res: ServerResponse
): void {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );
}


function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  if (res.writableEnded) {
    return;
  }

  const payload =
    JSON.stringify(body);

  res.statusCode =
    statusCode;

  setCommonHeaders(res);

  res.setHeader(
    "Content-Length",
    Buffer.byteLength(payload)
  );

  res.end(payload);
}


function createOpenAIError(
  message: string,
  type = "invalid_request_error",
  code: string | null = null,
  param: string | null = null
): OpenAIErrorResponse {
  return {
    error: {
      message,
      type,
      param,
      code
    }
  };
}


function normalizeErrorMessage(
  error: unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error === "string"
  ) {
    return error;
  }

  return "Unknown Browser Chat error";
}


function mapErrorStatus(
  message: string
): number {
  const normalized =
    message.toLowerCase();

  if (
    normalized.includes(
      "not found"
    ) ||
    normalized.includes(
      "unknown agent"
    )
  ) {
    return 404;
  }

  if (
    normalized.includes(
      "busy"
    )
  ) {
    return 409;
  }

  if (
    normalized.includes(
      "timeout"
    ) ||
    normalized.includes(
      "timed out"
    )
  ) {
    return 504;
  }

  if (
    normalized.includes(
      "offline"
    ) ||
    normalized.includes(
      "disconnected"
    )
  ) {
    return 503;
  }

  if (
    normalized.includes(
      "model is required"
    ) ||
    normalized.includes(
      "messages must be"
    ) ||
    normalized.includes(
      "no user message"
    ) ||
    normalized.includes(
      "invalid"
    )
  ) {
    return 400;
  }

  return 500;
}


function mapErrorType(
  statusCode: number
): string {
  if (
    statusCode >= 400 &&
    statusCode < 500
  ) {
    return "invalid_request_error";
  }

  return "server_error";
}


// ============================================================
// SSE
// ============================================================

function setSseHeaders(
  res: ServerResponse
): void {
  res.statusCode = 200;

  res.setHeader(
    "Content-Type",
    "text/event-stream; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache, no-store"
  );

  res.setHeader(
    "Connection",
    "keep-alive"
  );

  res.setHeader(
    "X-Accel-Buffering",
    "no"
  );
}


function writeSseData(
  res: ServerResponse,
  data: unknown
): void {
  if (
    res.writableEnded ||
    res.destroyed
  ) {
    return;
  }

  res.write(
    `data: ${JSON.stringify(data)}\n\n`
  );
}


function writeSseDone(
  res: ServerResponse
): void {
  if (
    res.writableEnded ||
    res.destroyed
  ) {
    return;
  }

  res.write(
    "data: [DONE]\n\n"
  );
}


/**
 * Convert a completed Browser Chat response into an
 * OpenAI-compatible buffered SSE response.
 *
 * This intentionally emits:
 *
 * 1. assistant role
 * 2. full content
 * 3. finish_reason=stop
 * 4. [DONE]
 *
 * Later we can replace the single content chunk with true
 * DOM-generated deltas without changing the public endpoint.
 */
function sendBufferedSse(
  res: ServerResponse,
  response: OpenAIChatCompletionResponse
): void {

  if (res.writableEnded) {
    return;
  }


  setSseHeaders(res);


  if (
    typeof res.flushHeaders ===
    "function"
  ) {

    res.flushHeaders();
  }


  const choice =
    response.choices?.[0];


  if (!choice) {

    writeSseDone(res);

    res.end();

    return;
  }


  const message =
    choice.message;


  // ==========================================================
  // 1. Assistant role
  // ==========================================================

  const roleChunk:
    OpenAIChatCompletionChunk = {

    id:
      response.id,

    object:
      "chat.completion.chunk",

    created:
      response.created,

    model:
      response.model,

    choices: [
      {
        index:
          0,

        delta: {
          role:
            "assistant"
        },

        finish_reason:
          null
      }
    ]
  };


  writeSseData(
    res,
    roleChunk
  );


  // ==========================================================
  // 2. Tool call
  // ==========================================================

  const toolCalls =
    message?.tool_calls;


  if (
    Array.isArray(toolCalls) &&
    toolCalls.length > 0
  ) {

    /*
     * Phase 1 supports one tool call per assistant response.
     *
     * We still iterate here so the SSE format remains compatible
     * if multiple tool calls are added later.
     */

    toolCalls.forEach(
      (
        toolCall,
        index
      ) => {

        const toolChunk:
          OpenAIChatCompletionChunk = {

          id:
            response.id,

          object:
            "chat.completion.chunk",

          created:
            response.created,

          model:
            response.model,

          choices: [
            {
              index:
                0,

              delta: {
                tool_calls: [
                  {
                    index,

                    id:
                      toolCall.id,

                    type:
                      toolCall.type,

                    function: {
                      name:
                        toolCall.function.name,

                      arguments:
                        toolCall.function.arguments
                    }
                  }
                ]
              },

              finish_reason:
                null
            }
          ]
        };


        writeSseData(
          res,
          toolChunk
        );
      }
    );


    // --------------------------------------------------------
    // OpenAI tool-call completion
    // --------------------------------------------------------

    const finishChunk:
      OpenAIChatCompletionChunk = {

      id:
        response.id,

      object:
        "chat.completion.chunk",

      created:
        response.created,

      model:
        response.model,

      choices: [
        {
          index:
            0,

          delta: {},

          finish_reason:
            "tool_calls"
        }
      ]
    };


    writeSseData(
      res,
      finishChunk
    );


    writeSseDone(res);

    res.end();

    return;
  }


  // ==========================================================
  // 3. Normal assistant content
  // ==========================================================

  const content =
    message?.content ??
    "";


  if (content) {

    const contentChunk:
      OpenAIChatCompletionChunk = {

      id:
        response.id,

      object:
        "chat.completion.chunk",

      created:
        response.created,

      model:
        response.model,

      choices: [
        {
          index:
            0,

          delta: {
            content
          },

          finish_reason:
            null
        }
      ]
    };


    writeSseData(
      res,
      contentChunk
    );
  }


  // ==========================================================
  // 4. Normal completion
  // ==========================================================

  const finishChunk:
    OpenAIChatCompletionChunk = {

    id:
      response.id,

    object:
      "chat.completion.chunk",

    created:
      response.created,

    model:
      response.model,

    choices: [
      {
        index:
          0,

        delta: {},

        finish_reason:
          choice.finish_reason ===
            "tool_calls"
            ? "tool_calls"
            : "stop"
      }
    ]
  };


  writeSseData(
    res,
    finishChunk
  );


  writeSseDone(res);

  res.end();
}

// ============================================================
// Request body
// ============================================================

async function readJsonBody(
  req: IncomingMessage,
  maxBodyBytes: number
): Promise<any> {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const chunks:
        Buffer[] = [];

      let receivedBytes =
        0;

      let finished =
        false;

      const fail = (
        error: Error
      ) => {
        if (finished) {
          return;
        }

        finished = true;
        reject(error);
      };

      req.on(
        "data",
        (
          chunk:
            Buffer | string
        ) => {
          if (finished) {
            return;
          }

          const buffer =
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk);

          receivedBytes +=
            buffer.length;

          if (
            receivedBytes >
            maxBodyBytes
          ) {
            fail(
              new Error(
                "Request body too large"
              )
            );

            return;
          }

          chunks.push(buffer);
        }
      );

      req.on(
        "end",
        () => {
          if (finished) {
            return;
          }

          finished = true;

          const raw =
            Buffer.concat(chunks)
              .toString("utf8")
              .trim();

          if (!raw) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(raw)
            );
          } catch {
            reject(
              new Error(
                "Invalid JSON request body"
              )
            );
          }
        }
      );

      req.on(
        "error",
        (error) => {
          fail(
            error instanceof Error
              ? error
              : new Error(
                String(error)
              )
          );
        }
      );

      req.on(
        "aborted",
        () => {
          fail(
            new Error(
              "Request aborted"
            )
          );
        }
      );
    }
  );
}


// ============================================================
// Request validation
// ============================================================

function validateChatCompletionRequest(
  body: any
): asserts body is OpenAIChatCompletionRequest {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new Error(
      "Invalid chat completion request"
    );
  }

  if (
    typeof body.model !== "string" ||
    !body.model.trim()
  ) {
    throw new Error(
      "model is required"
    );
  }

  if (
    !Array.isArray(
      body.messages
    )
  ) {
    throw new Error(
      "messages must be an array"
    );
  }

  if (
    body.messages.length === 0
  ) {
    throw new Error(
      "messages must not be empty"
    );
  }

  if (
    body.stream !== undefined &&
    typeof body.stream !== "boolean"
  ) {
    throw new Error(
      "stream must be a boolean"
    );
  }
}


// ============================================================
// Handler
// ============================================================

export class BrowserChatOpenAIHttpHandler {
  private readonly adapter:
    BrowserChatOpenAIAdapter;

  private readonly maxBodyBytes:
    number;

  constructor(
    adapter:
      BrowserChatOpenAIAdapter,

    options:
      BrowserChatOpenAIHttpHandlerOptions = {}
  ) {
    if (!adapter) {
      throw new Error(
        "BrowserChatOpenAIAdapter is required"
      );
    }

    this.adapter =
      adapter;

    this.maxBodyBytes =
      options.maxBodyBytes ??
      DEFAULT_MAX_BODY_BYTES;
  }


  /**
   * Check whether this request belongs to the
   * Browser Chat OpenAI API.
   */
  isRequest(
    req: IncomingMessage
  ): boolean {
    const path =
      getRequestPath(req);

    return (
      path ===
      BROWSER_CHAT_OPENAI_MODELS_PATH ||
      path ===
      BROWSER_CHAT_OPENAI_CHAT_COMPLETIONS_PATH
    );
  }


  /**
   * Handle a Browser Chat OpenAI request.
   *
   * true  -> request belonged to Browser Chat API
   * false -> request did not belong to Browser Chat API
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    const path =
      getRequestPath(req);

    if (
      path ===
      BROWSER_CHAT_OPENAI_MODELS_PATH
    ) {
      await this.handleModels(
        req,
        res
      );

      return true;
    }

    if (
      path ===
      BROWSER_CHAT_OPENAI_CHAT_COMPLETIONS_PATH
    ) {
      await this.handleChatCompletions(
        req,
        res
      );

      return true;
    }

    return false;
  }


  // ==========================================================
  // GET /v1/models
  // ==========================================================

  private async handleModels(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (
      req.method !== "GET"
    ) {
      res.setHeader(
        "Allow",
        "GET"
      );

      sendJson(
        res,
        405,
        createOpenAIError(
          "Method not allowed",
          "invalid_request_error",
          "method_not_allowed"
        )
      );

      return;
    }

    try {
      const result =
        await this.adapter.listModels();

      sendJson(
        res,
        200,
        result
      );
    } catch (error) {
      this.sendError(
        res,
        error
      );
    }
  }


  // ==========================================================
  // POST /v1/chat/completions
  // ==========================================================

  private async handleChatCompletions(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (
      req.method !== "POST"
    ) {
      res.setHeader(
        "Allow",
        "POST"
      );

      sendJson(
        res,
        405,
        createOpenAIError(
          "Method not allowed",
          "invalid_request_error",
          "method_not_allowed"
        )
      );

      return;
    }

    try {
      const body =
        await readJsonBody(
          req,
          this.maxBodyBytes
        );

      validateChatCompletionRequest(
        body
      );

      const result =
        await this.adapter
          .createChatCompletion(
            body
          );

      if (
        result.streamRequested
      ) {
        sendBufferedSse(
          res,
          result.response
        );

        return;
      }

      sendJson(
        res,
        200,
        result.response
      );
    } catch (error) {
      this.sendError(
        res,
        error
      );
    }
  }


  // ==========================================================
  // Errors
  // ==========================================================

  private sendError(
    res: ServerResponse,
    error: unknown
  ): void {
    // If an SSE response has already started, we cannot safely
    // switch the response back to application/json.
    if (
      res.headersSent
    ) {
      if (
        !res.writableEnded
      ) {
        res.end();
      }

      return;
    }

    const message =
      normalizeErrorMessage(
        error
      );

    const statusCode =
      mapErrorStatus(
        message
      );

    const type =
      mapErrorType(
        statusCode
      );

    let code:
      string | null = null;

    if (
      statusCode === 404
    ) {
      code =
        "model_not_found";
    } else if (
      statusCode === 409
    ) {
      code =
        "agent_busy";
    } else if (
      statusCode === 503
    ) {
      code =
        "provider_unavailable";
    } else if (
      statusCode === 504
    ) {
      code =
        "timeout";
    }

    sendJson(
      res,
      statusCode,
      createOpenAIError(
        message,
        type,
        code
      )
    );
  }
}


// ============================================================
// Factory
// ============================================================

export function createBrowserChatOpenAIHttpHandler(
  adapter:
    BrowserChatOpenAIAdapter,

  options:
    BrowserChatOpenAIHttpHandlerOptions = {}
): BrowserChatOpenAIHttpHandler {
  return new BrowserChatOpenAIHttpHandler(
    adapter,
    options
  );
}
