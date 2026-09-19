// openai/adapter.ts
//
// OpenAI-compatible adapter for Browser Chat.
//
// Browser Chat agents are exposed as OpenAI-compatible models.
// Each model maps directly to one registered browser agent.
//
// Tool Calling V1 / Phase 1:
// - Accept OpenAI function tools
// - Encode tool definitions into the ChatGPT Web prompt
// - Detect Browser Chat structured tool-call output
// - Convert it into OpenAI-compatible tool_calls
// - ONE tool call per assistant response
//
// Phase 2 will add:
// - role:"tool" handling
// - tool-result round trip back into the same browser conversation

// ============================================================
// OpenAI types
// ============================================================

export interface OpenAIToolCall {
  id: string;

  type: "function";

  function: {
    name: string;
    arguments: string;
  };
}


export interface OpenAIFunctionTool {
  type: "function";

  function: {
    name: string;

    description?: string;

    parameters?: Record<
      string,
      unknown
    >;
  };
}


export interface BrowserChatOpenAIAdapterDependencies {
  browserChatAsk: (
    requestManager: unknown,
    agentRegistry: unknown,
    input: {
      agent: string;
      prompt: string;
      stream?: boolean;
      timeoutMs?: number;
    }
  ) => Promise<any>;

  browserChatList: (
    agentRegistry: unknown
  ) => Promise<any>;

  requestManager: unknown;
  agentRegistry: unknown;
}


export interface OpenAIChatContentPart {
  type?: string;
  text?: string;

  [key: string]: unknown;
}


export interface OpenAIChatMessage {
  role:
  | "system"
  | "user"
  | "assistant"
  | "tool";

  content:
  | string
  | OpenAIChatContentPart[]
  | null;

  tool_call_id?: string;

  tool_calls?: OpenAIToolCall[];

  [key: string]: unknown;
}


export interface OpenAIChatCompletionRequest {
  model: string;

  messages:
  OpenAIChatMessage[];

  stream?: boolean;

  temperature?: number;

  max_tokens?: number;

  max_completion_tokens?: number;

  tools?: OpenAIFunctionTool[];

  tool_choice?: unknown;

  parallel_tool_calls?: boolean;

  [key: string]: unknown;
}


export interface OpenAIModel {
  id: string;

  object:
  "model";

  created:
  number;

  owned_by:
  string;
}


export interface OpenAIModelList {
  object:
  "list";

  data:
  OpenAIModel[];
}


export interface OpenAIChatCompletionResponse {
  id:
  string;

  object:
  "chat.completion";

  created:
  number;

  model:
  string;

  choices:
  Array<{
    index:
    number;

    message: {
      role:
      "assistant";

      content:
      string | null;

      tool_calls?:
      OpenAIToolCall[];
    };

    finish_reason:
    | "stop"
    | "tool_calls";
  }>;

  usage: {
    prompt_tokens:
    number;

    completion_tokens:
    number;

    total_tokens:
    number;
  };
}


/**
 * Internal result used by the HTTP compatibility layer.
 *
 * Browser Chat is still buffered internally.
 * http-handler.ts decides whether the completed result is
 * returned as JSON or serialized as buffered SSE.
 */
export interface BrowserChatOpenAICompletionResult {
  streamRequested:
  boolean;

  response:
  OpenAIChatCompletionResponse;
}


export interface BrowserChatOpenAIAdapterOptions {
  timeoutMs?:
  number;
}


const DEFAULT_TIMEOUT_MS =
  180_000;


// ============================================================
// IDs
// ============================================================

function createId(
  prefix:
    string
): string {

  const random =
    Math.random()
      .toString(36)
      .slice(2, 14);


  return (
    `${prefix}_` +
    `${Date.now().toString(36)}_` +
    random
  );
}


// ============================================================
// Message conversion
// ============================================================

function extractTextContent(
  content:
    OpenAIChatMessage["content"]
): string {

  if (
    typeof content ===
    "string"
  ) {

    return content.trim();
  }


  if (
    !Array.isArray(
      content
    )
  ) {

    return "";
  }


  return content
    .map(
      part => {

        if (
          typeof part ===
          "string"
        ) {

          return part;
        }


        if (
          part &&
          typeof part ===
          "object" &&
          typeof part.text ===
          "string"
        ) {

          return part.text;
        }


        return "";
      }
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}


/**
 * Browser Chat conversations already own their history inside
 * ChatGPT Web.
 *
 * Phase 1 deliberately sends only the newest user message.
 *
 * Phase 2 will additionally recognize role:"tool" so a tool
 * result can be returned to the same browser conversation.
 */
function extractLatestUserPrompt(
  messages:
    OpenAIChatMessage[]
): string {

  if (
    !Array.isArray(
      messages
    )
  ) {

    throw new Error(
      "messages must be an array"
    );
  }


  for (
    let index =
      messages.length - 1;

    index >= 0;

    index--
  ) {

    const message =
      messages[index];


    if (
      message?.role !==
      "user"
    ) {

      continue;
    }


    const text =
      extractTextContent(
        message.content
      );


    if (text) {

      return text;
    }
  }


  throw new Error(
    "No user message found"
  );
}

// ============================================================
// Tool Result / Phase 2
// ============================================================

interface ToolResultContinuation {
  toolCallId: string;
  toolName: string;
  result: string;
}


/**
 * Detect the newest OpenAI tool-result message.
 *
 * OpenAI normally sends:
 *
 * user
 *   ↓
 * assistant + tool_calls
 *   ↓
 * tool + tool_call_id
 *
 * Browser Chat must NOT replay the old user message in this
 * situation because ChatGPT Web already owns that history.
 */
function extractLatestToolResult(
  messages:
    OpenAIChatMessage[]
): ToolResultContinuation | null {

  if (
    !Array.isArray(messages) ||
    messages.length === 0
  ) {

    return null;
  }


  const lastMessage =
    messages[
    messages.length - 1
    ];


  if (
    lastMessage?.role !==
    "tool"
  ) {

    return null;
  }


  const toolCallId =
    typeof lastMessage
      .tool_call_id ===
      "string"
      ? lastMessage
        .tool_call_id
        .trim()
      : "";


  if (!toolCallId) {

    throw new Error(
      "Tool result is missing tool_call_id"
    );
  }


  const result =
    extractTextContent(
      lastMessage.content
    );


  /*
   * Find the assistant tool call that produced this result.
   */
  let toolName =
    "";


  for (
    let index =
      messages.length - 2;

    index >= 0;

    index--
  ) {

    const message =
      messages[index];


    if (
      message?.role !==
      "assistant" ||
      !Array.isArray(
        message.tool_calls
      )
    ) {

      continue;
    }


    const matchingToolCall =
      message.tool_calls.find(
        toolCall =>
          toolCall?.id ===
          toolCallId
      );


    if (!matchingToolCall) {

      continue;
    }


    toolName =
      String(
        matchingToolCall
          .function
          ?.name ??
        ""
      ).trim();


    break;
  }


  if (!toolName) {

    throw new Error(
      `Unable to resolve tool call "${toolCallId}"`
    );
  }


  return {
    toolCallId,
    toolName,
    result
  };
}


/**
 * Build the continuation message sent into the SAME ChatGPT Web
 * conversation after the external client has executed a tool.
 */
function buildToolResultPrompt(
  toolResult:
    ToolResultContinuation,

  toolInstruction:
    string
): string {

  const continuation =
    `
External tool execution completed.

Tool:
${toolResult.toolName}

Tool call ID:
${toolResult.toolCallId}

Result:
${toolResult.result || "(empty result)"}

Continue solving the original user request using this tool result.

If another external tool is required, request exactly ONE tool
using the BROWSER_CHAT_TOOL_CALL format.

Otherwise provide the final answer normally.
`.trim();


  /*
   * Include the tool protocol again because another tool may be
   * required after this result.
   */
  if (toolInstruction) {

    return (
      `${toolInstruction}\n\n` +
      continuation
    );
  }


  return continuation;
}

// ============================================================
// Tool Calling V1
// ============================================================

interface ParsedBrowserToolCall {
  name: string;

  arguments:
  Record<
    string,
    unknown
  >;
}


/**
 * Convert OpenAI function tools into an instruction that
 * ChatGPT Web can understand.
 *
 * ChatGPT Web does not receive OpenAI `tools` directly, so the
 * adapter asks it to return a strict structured marker whenever
 * an external tool is required.
 */
function buildToolInstruction(
  tools:
    OpenAIFunctionTool[]
): string {

  if (
    !Array.isArray(tools) ||
    tools.length === 0
  ) {

    return "";
  }


  const definitions =
    tools
      .filter(
        tool =>
          tool?.type ===
          "function" &&
          typeof tool.function?.name ===
          "string" &&
          Boolean(
            tool.function.name.trim()
          )
      )
      .map(
        tool => ({
          name:
            tool.function.name.trim(),

          description:
            tool.function.description ||
            "",

          parameters:
            tool.function.parameters ||
            {}
        })
      );


  if (
    definitions.length === 0
  ) {

    return "";
  }

  return `
You have access to external tools.

These tools are NOT executed inside this browser conversation.
An external agent will execute a requested tool and return its result.

Available tools:

${JSON.stringify(
    definitions,
    null,
    2
  )}

If a tool is required, respond ONLY with exactly this structure:

<BROWSER_CHAT_TOOL_CALL>
{
  "name": "tool_name",
  "arguments": {}
}
</BROWSER_CHAT_TOOL_CALL>

Tool-call rules:

- Use only a tool listed above.
- Output strict valid JSON parseable by JSON.parse().
- "arguments" must be a valid JSON object.
- Escape ALL characters required by JSON, including double quotes inside string values.
- NEVER use raw backslashes inside JSON strings.
- Use forward slashes for ALL paths, including relative paths.
- Valid path examples: openai/adapter.ts and C:/Users/name/project/file.txt
- Prefer commands that avoid nested quotes when an equivalent command exists.
- Do not use Markdown code fences or text outside the tool-call tags.
- Request exactly ONE tool per response.
- After a tool result, continue with another tool call if more work is needed.
- If no tool is required, answer normally.
- Before responding, verify that JSON.parse() can parse the exact content between the tool-call tags.
`.trim();
}
/**
 * Parse the Browser Chat structured marker.
 */
function parseBrowserToolCall(
  content:
    string
): ParsedBrowserToolCall | null {

  if (!content) {

    return null;
  }


  const match =
    content.match(
      /<BROWSER_CHAT_TOOL_CALL>\s*([\s\S]*?)\s*<\/BROWSER_CHAT_TOOL_CALL>/i
    );


  if (!match) {

    return null;
  }


  const json =
    match[1]?.trim();


  if (!json) {

    throw new Error(
      "Browser Chat returned an empty tool call"
    );
  }


  let parsed:
    unknown;


  try {

    parsed =
      JSON.parse(
        json
      );

  } catch {

    throw new Error(
      "Browser Chat returned invalid tool-call JSON"
    );
  }


  if (
    !parsed ||
    typeof parsed !==
    "object" ||
    Array.isArray(parsed)
  ) {

    throw new Error(
      "Browser Chat returned invalid tool call"
    );
  }


  const value =
    parsed as {
      name?: unknown;
      arguments?: unknown;
    };


  if (
    typeof value.name !==
    "string" ||
    !value.name.trim()
  ) {

    throw new Error(
      "Browser Chat tool call is missing name"
    );
  }


  if (
    !value.arguments ||
    typeof value.arguments !==
    "object" ||
    Array.isArray(
      value.arguments
    )
  ) {

    throw new Error(
      "Browser Chat tool arguments must be an object"
    );
  }


  return {
    name:
      value.name.trim(),

    arguments:
      value.arguments as
      Record<
        string,
        unknown
      >
  };
}


/**
 * Tool names are controlled by the OpenAI client.
 *
 * ChatGPT Web may request only tools that were actually included
 * in the incoming OpenAI request.
 */
function validateToolCall(
  toolCall:
    ParsedBrowserToolCall,

  tools:
    OpenAIFunctionTool[]
): void {

  const allowedTools =
    new Set(
      (tools || [])
        .filter(
          tool =>
            tool?.type ===
            "function" &&
            typeof tool.function?.name ===
            "string"
        )
        .map(
          tool =>
            tool.function.name.trim()
        )
        .filter(Boolean)
    );


  if (
    !allowedTools.has(
      toolCall.name
    )
  ) {

    throw new Error(
      `Browser Chat requested unknown tool "${toolCall.name}"`
    );
  }
}


// ============================================================
// Model normalization
// ============================================================

function normalizeModelId(
  model:
    unknown
): string {

  const value =
    String(
      model ?? ""
    ).trim();


  if (!value) {

    throw new Error(
      "model is required"
    );
  }


  const prefix =
    "browser-chat/";


  if (
    value.startsWith(
      prefix
    )
  ) {

    const agentId =
      value
        .slice(
          prefix.length
        )
        .trim();


    if (!agentId) {

      throw new Error(
        "Invalid Browser Chat model"
      );
    }


    return agentId;
  }


  return value;
}


// ============================================================
// Token approximation
// ============================================================

/**
 * Browser Chat cannot currently obtain real token usage from
 * ChatGPT Web.
 */
function estimateTokens(
  text:
    string
): number {

  if (!text) {

    return 0;
  }


  return Math.max(
    1,
    Math.ceil(
      text.length / 4
    )
  );
}


// ============================================================
// Agent list normalization
// ============================================================

function extractAgentArray(
  result:
    any
): any[] {

  if (
    Array.isArray(
      result
    )
  ) {

    return result;
  }


  if (
    Array.isArray(
      result?.agents
    )
  ) {

    return result.agents;
  }


  if (
    Array.isArray(
      result?.data
    )
  ) {

    return result.data;
  }


  return [];
}


function extractAgentId(
  agent:
    any
): string {

  if (
    typeof agent ===
    "string"
  ) {

    return agent.trim();
  }


  return String(
    agent?.agentId ??
    agent?.id ??
    agent?.name ??
    ""
  ).trim();
}


/**
 * Offline/error agents are not advertised as models.
 *
 * Busy agents remain valid models. RequestManager remains
 * responsible for AGENT_BUSY.
 */
function isAgentAvailable(
  agent:
    any
): boolean {

  if (
    typeof agent ===
    "string"
  ) {

    return true;
  }


  const status =
    String(
      agent?.status ??
      ""
    )
      .trim()
      .toLowerCase();


  if (!status) {

    return true;
  }


  return ![
    "offline",
    "error"
  ].includes(
    status
  );
}


// ============================================================
// Adapter
// ============================================================

export class BrowserChatOpenAIAdapter {

  private readonly deps:
    BrowserChatOpenAIAdapterDependencies;

  private readonly timeoutMs:
    number;


  constructor(
    dependencies:
      BrowserChatOpenAIAdapterDependencies,

    options:
      BrowserChatOpenAIAdapterOptions = {}
  ) {

    if (!dependencies) {

      throw new Error(
        "Browser Chat dependencies are required"
      );
    }


    if (
      typeof dependencies
        .browserChatAsk !==
      "function"
    ) {

      throw new Error(
        "browserChatAsk dependency is required"
      );
    }


    if (
      typeof dependencies
        .browserChatList !==
      "function"
    ) {

      throw new Error(
        "browserChatList dependency is required"
      );
    }


    if (
      !dependencies
        .requestManager
    ) {

      throw new Error(
        "requestManager dependency is required"
      );
    }


    if (
      !dependencies
        .agentRegistry
    ) {

      throw new Error(
        "agentRegistry dependency is required"
      );
    }


    this.deps =
      dependencies;


    this.timeoutMs =
      options.timeoutMs ??
      DEFAULT_TIMEOUT_MS;
  }


  // ==========================================================
  // Models
  // ==========================================================

  async listModels():
    Promise<OpenAIModelList> {

    const result =
      await this.deps
        .browserChatList(
          this.deps
            .agentRegistry
        );


    const agents =
      extractAgentArray(
        result
      );


    const created =
      Math.floor(
        Date.now() /
        1000
      );


    const data:
      OpenAIModel[] = [];


    const seen =
      new Set<string>();


    for (
      const agent
      of agents
    ) {

      if (
        !isAgentAvailable(
          agent
        )
      ) {

        continue;
      }


      const agentId =
        extractAgentId(
          agent
        );


      if (
        !agentId ||
        seen.has(
          agentId
        )
      ) {

        continue;
      }


      seen.add(
        agentId
      );


      data.push({
        id:
          agentId,

        object:
          "model",

        created,

        owned_by:
          "browser-chat"
      });
    }


    return {
      object:
        "list",

      data
    };
  }


  // ==========================================================
  // Chat completions
  // ==========================================================
  async createChatCompletion(
    request:
      OpenAIChatCompletionRequest
  ): Promise<
    BrowserChatOpenAICompletionResult
  > {

    if (
      !request ||
      typeof request !==
      "object"
    ) {

      throw new Error(
        "Invalid chat completion request"
      );
    }


    const streamRequested =
      request.stream ===
      true;


    const agentId =
      normalizeModelId(
        request.model
      );


    // --------------------------------------------------------
    // OpenAI tools available for this request.
    // --------------------------------------------------------

    const tools =
      Array.isArray(
        request.tools
      )
        ? request.tools
        : [];


    console.log(
      "[BrowserChatOpenAI] Incoming tools:",
      tools.map(
        tool => ({
          type:
            tool?.type,

          name:
            tool?.function?.name,

          description:
            tool?.function?.description
              ? true
              : false
        })
      )
    );


    const toolInstruction =
      buildToolInstruction(
        tools
      );


    console.log(
      "[BrowserChatOpenAI] Tool instruction:",
      {
        enabled:
          Boolean(toolInstruction),

        toolCount:
          tools.length,

        toolNames:
          tools
            .map(
              tool =>
                tool?.function?.name
            )
            .filter(Boolean)
      }
    );


    // --------------------------------------------------------
    // Phase 2:
    //
    // Determine whether this request is:
    //
    // 1. A new user request
    // 2. A tool-result continuation
    //
    // ChatGPT Web already owns the conversation history, so
    // previous messages must NOT be replayed into the browser.
    // --------------------------------------------------------

    const toolResult =
      extractLatestToolResult(
        request.messages
      );


    let prompt:
      string;


    if (toolResult) {

      // ------------------------------------------------------
      // Tool result continuation.
      //
      // Example OpenAI history:
      //
      // user
      // assistant + tool_calls
      // tool + tool_call_id
      //
      // Only append the tool result to the existing browser
      // conversation.
      // ------------------------------------------------------

      prompt =
        buildToolResultPrompt(
          toolResult,
          toolInstruction
        );

    } else {

      // ------------------------------------------------------
      // Normal user request.
      // ------------------------------------------------------

      const userPrompt =
        extractLatestUserPrompt(
          request.messages
        );


      prompt =
        toolInstruction
          ? (
            `${toolInstruction}\n\n` +
            `USER REQUEST:\n` +
            userPrompt
          )
          : userPrompt;
    }


    /*
     * Keep Browser Chat internally buffered for now.
     *
     * True delta streaming is a separate feature.
     */

    const result =
      await this.deps
        .browserChatAsk(
          this.deps
            .requestManager,

          this.deps
            .agentRegistry,

          {
            agent:
              agentId,

            prompt,

            stream:
              false,

            timeoutMs:
              this.timeoutMs
          }
        );


    if (
      result?.status &&
      result.status !==
      "completed"
    ) {

      throw new Error(
        `Browser Chat request ended with status "${result.status}"`
      );
    }


    const content =
      String(
        result?.content ??
        ""
      );


    // --------------------------------------------------------
    // Detect Browser Chat tool request.
    //
    // This works for BOTH:
    //
    // user -> tool call
    //
    // and:
    //
    // tool result -> another tool call
    // --------------------------------------------------------

    const parsedToolCall =
      parseBrowserToolCall(
        content
      );


    if (parsedToolCall) {

      validateToolCall(
        parsedToolCall,
        tools
      );
    }


    // --------------------------------------------------------
    // Convert Browser Chat marker into OpenAI tool_call.
    // --------------------------------------------------------

    const toolCall:
      OpenAIToolCall | null =
      parsedToolCall
        ? {
          id:
            createId(
              "call"
            ),

          type:
            "function",

          function: {
            name:
              parsedToolCall.name,

            arguments:
              JSON.stringify(
                parsedToolCall.arguments
              )
          }
        }
        : null;


    const created =
      Math.floor(
        Date.now() /
        1000
      );


    const promptTokens =
      estimateTokens(
        prompt
      );


    /*
     * The Browser Chat marker itself is transport metadata.
     *
     * Do not count it as assistant content when returning an
     * OpenAI tool call.
     */

    const completionTokens =
      toolCall
        ? 0
        : estimateTokens(
          content
        );


    const response:
      OpenAIChatCompletionResponse = {

      id:
        createId(
          "chatcmpl-browser"
        ),

      object:
        "chat.completion",

      created,

      model:
        agentId,

      choices: [
        {
          index:
            0,

          message:
            toolCall
              ? {
                role:
                  "assistant",

                content:
                  null,

                tool_calls: [
                  toolCall
                ]
              }
              : {
                role:
                  "assistant",

                content
              },

          finish_reason:
            toolCall
              ? "tool_calls"
              : "stop"
        }
      ],

      usage: {
        prompt_tokens:
          promptTokens,

        completion_tokens:
          completionTokens,

        total_tokens:
          promptTokens +
          completionTokens
      }
    };


    return {
      streamRequested,
      response
    };
  }
}
// ============================================================
// Factory
// ============================================================

export function createBrowserChatOpenAIAdapter(
  dependencies:
    BrowserChatOpenAIAdapterDependencies,

  options:
    BrowserChatOpenAIAdapterOptions = {}
): BrowserChatOpenAIAdapter {

  return new BrowserChatOpenAIAdapter(
    dependencies,
    options
  );
}