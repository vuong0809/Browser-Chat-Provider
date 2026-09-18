// src/providers/chatgpt/selectors.js

/**
 * ChatGPT DOM selectors.
 *
 * IMPORTANT:
 * ChatGPT is a SPA and its DOM may change over time.
 *
 * Rules:
 * 1. Prefer semantic/stable attributes.
 * 2. Avoid generated CSS class names.
 * 3. Keep multiple fallbacks.
 * 4. Keep all ChatGPT-specific selectors in this file.
 */

// ============================================================
// Composer
// ============================================================

export const COMPOSER_SELECTORS = Object.freeze([
  "#prompt-textarea",
  '[data-testid="prompt-textarea"]',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  "textarea"
]);

// ============================================================
// Send button
// ============================================================

export const SEND_BUTTON_SELECTORS = Object.freeze([
  'button[type="submit"][aria-label="Gửi"]',
  'button[type="submit"][aria-label="Send"]',
  '[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]',
  'button[type="submit"]'
]);

// ============================================================
// Stop generating button
// ============================================================

export const STOP_BUTTON_SELECTORS = Object.freeze([
  '[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label="Stop"]'
]);

// ============================================================
// Assistant messages
// ============================================================

export const ASSISTANT_MESSAGE_SELECTORS = Object.freeze([
  '[data-content-search-unit-key$=":assistant"] [data-markdown-text-style="assistant-message"]',
  '[data-content-search-unit-key$=":assistant"]',
  '[data-markdown-text-style="assistant-message"]',
  '[data-message-author-role="assistant"]',
  'article[data-turn="assistant"]',
  '[data-markdown-copy="inline-code"]'
]);

// ============================================================
// User messages
// ============================================================

export const USER_MESSAGE_SELECTORS = Object.freeze([
  '[data-content-search-unit-key$=":user"]',
  '[data-user-message-bubble="true"]',
  '[data-message-author-role="user"]',
  'article[data-turn="user"]'
]);

// ============================================================
// Conversation turns
// ============================================================

export const TURN_SELECTORS = Object.freeze([
  "[data-turn-key]",
  "[data-content-search-turn-key]",
  '[data-testid^="conversation-turn-"]',
  "article"
]);

// ============================================================
// Main conversation area
// ============================================================

export const CONVERSATION_SELECTORS = Object.freeze([
  "main",
  '[role="main"]'
]);

// ============================================================
// Query helpers
// ============================================================

export function queryFirst(selectors, root = document) {
  if (!selectors || !root) {
    return null;
  }

  const list =
    Array.isArray(selectors)
      ? selectors
      : [selectors];

  for (const selector of list) {
    try {
      const element =
        root.querySelector(selector);

      if (element) {
        return element;
      }
    } catch (error) {
      console.debug(
        "[ChatGPTSelectors] Invalid selector:",
        selector,
        error
      );
    }
  }

  return null;
}

export function queryAll(selectors, root = document) {
  if (!selectors || !root) {
    return [];
  }

  const list =
    Array.isArray(selectors)
      ? selectors
      : [selectors];

  /*
   * Use the first selector that returns elements.
   *
   * This avoids duplicates when multiple fallback selectors
   * match the same ChatGPT messages.
   */
  for (const selector of list) {
    try {
      const elements =
        Array.from(
          root.querySelectorAll(selector)
        );

      if (elements.length > 0) {
        return elements;
      }
    } catch (error) {
      console.debug(
        "[ChatGPTSelectors] Invalid selector:",
        selector,
        error
      );
    }
  }

  return [];
}

// ============================================================
// Element visibility
// ============================================================

export function isVisible(element) {
  if (!element) {
    return false;
  }

  if (!element.isConnected) {
    return false;
  }

  const style =
    window.getComputedStyle(element);

  if (
    style.display === "none" ||
    style.visibility === "hidden"
  ) {
    return false;
  }

  const rect =
    element.getBoundingClientRect();

  return (
    rect.width > 0 &&
    rect.height > 0
  );
}

export function queryFirstVisible(
  selectors,
  root = document
) {
  const list =
    Array.isArray(selectors)
      ? selectors
      : [selectors];

  for (const selector of list) {
    let elements;

    try {
      elements =
        root.querySelectorAll(selector);
    } catch {
      continue;
    }

    for (const element of elements) {
      if (isVisible(element)) {
        return element;
      }
    }
  }

  return null;
}

// ============================================================
// Composer helpers
// ============================================================

export function findComposer() {
  return queryFirstVisible(
    COMPOSER_SELECTORS
  );
}

export function findSendButton() {

  /*
   * ChatGPT's composer send button can temporarily report a
   * zero-sized bounding rect while React/layout is updating.
   *
   * Do not use queryFirstVisible() here. The caller will validate
   * whether the button is usable through isButtonEnabled().
   */

  return queryFirst(
    SEND_BUTTON_SELECTORS
  );
}

export function findStopButton() {
  return queryFirstVisible(
    STOP_BUTTON_SELECTORS
  );
}

// ============================================================
// Message helpers
// ============================================================

export function getAssistantMessages() {
  return queryAll(
    ASSISTANT_MESSAGE_SELECTORS
  );
}

export function getUserMessages() {
  return queryAll(
    USER_MESSAGE_SELECTORS
  );
}

export function getConversationTurns() {
  return queryAll(
    TURN_SELECTORS
  );
}

export function getLatestAssistantMessage() {
  const messages =
    getAssistantMessages();

  if (messages.length === 0) {
    return null;
  }

  return messages[
    messages.length - 1
  ];
}

export function getLatestUserMessage() {
  const messages =
    getUserMessages();

  if (messages.length === 0) {
    return null;
  }

  return messages[
    messages.length - 1
  ];
}

export function getConversationRoot() {
  return (
    queryFirstVisible(
      CONVERSATION_SELECTORS
    ) ||
    document.body
  );
}

// ============================================================
// Plain text extraction
// ============================================================

export function getElementText(element) {
  if (!element) {
    return "";
  }

  const text =
    element.innerText ??
    element.textContent ??
    "";

  return text.trim();
}

// ============================================================
// Markdown extraction
// ============================================================

function normalizeMarkdownWhitespace(value) {
  return String(value || "")
    .replace(/\u200b/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeMarkdownTableCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

// ============================================================
// Code language
// ============================================================

function getCodeLanguage(element) {
  const code =
    element?.matches?.("code")
      ? element
      : element?.querySelector?.("code");

  if (!code) {
    return "";
  }

  const className =
    typeof code.className === "string"
      ? code.className
      : "";

  const match =
    className.match(
      /(?:language-|lang-)([a-zA-Z0-9_+#.-]+)/
    );

  return (
    match?.[1] ||
    code.getAttribute("data-language") ||
    element?.getAttribute?.("data-language") ||
    ""
  ).trim();
}

// ============================================================
// Markdown serializer
// ============================================================

function serializeChildren(
  element,
  context = {}
) {
  return Array.from(
    element.childNodes
  )
    .map(
      (node) =>
        serializeMarkdownNode(
          node,
          context
        )
    )
    .join("");
}

function serializeList(
  element,
  context = {}
) {
  const ordered =
    element.tagName
      ?.toLowerCase() === "ol";

  let index = 0;

  const items =
    Array.from(
      element.children
    ).filter(
      (child) =>
        child.tagName
          ?.toLowerCase() === "li"
    );

  return items
    .map((item) => {
      index += 1;

      const prefix =
        ordered
          ? `${index}. `
          : "- ";

      const content =
        serializeChildren(
          item,
          {
            ...context,
            inListItem: true
          }
        )
          .trim()
          .replace(
            /\n/g,
            "\n  "
          );

      return (
        prefix +
        content
      );
    })
    .join("\n");
}

function serializeTable(
  table,
  context = {}
) {
  const rows =
    Array.from(
      table.querySelectorAll(
        "tr"
      )
    );

  if (rows.length === 0) {
    return "";
  }

  const matrix =
    rows.map(
      (row) =>
        Array.from(
          row.querySelectorAll(
            ":scope > th, :scope > td"
          )
        ).map(
          (cell) =>
            escapeMarkdownTableCell(
              serializeChildren(
                cell,
                context
              ).trim()
            )
        )
    );

  const width =
    Math.max(
      1,
      ...matrix.map(
        (row) =>
          row.length
      )
    );

  const normalized =
    matrix.map(
      (row) => [
        ...row,
        ...Array(
          Math.max(
            0,
            width -
              row.length
          )
        ).fill("")
      ]
    );

  const header =
    normalized[0];

  const separator =
    Array(width).fill(
      "---"
    );

  const body =
    normalized.slice(1);

  return [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...body.map(
      (row) =>
        `| ${row.join(" | ")} |`
    )
  ].join("\n");
}

// ============================================================
// Node -> Markdown
// ============================================================

function serializeMarkdownNode(
  node,
  context = {}
) {
  if (!node) {
    return "";
  }

  // ----------------------------------------------------------
  // Text
  // ----------------------------------------------------------

  if (
    node.nodeType ===
    Node.TEXT_NODE
  ) {
    return (
      node.nodeValue ||
      ""
    );
  }

  if (
    node.nodeType !==
    Node.ELEMENT_NODE
  ) {
    return "";
  }

  const element =
    node;

  // ----------------------------------------------------------
  // Ignore ChatGPT UI
  // ----------------------------------------------------------

  if (
    element.matches(
      [
        ".sr-only",
        "button",
        "script",
        "style",
        "noscript",
        "[aria-hidden='true']",
        ".turn-action-controls"
      ].join(",")
    )
  ) {
    return "";
  }

  // ----------------------------------------------------------
  // Image
  // ----------------------------------------------------------

  if (
    element.matches("img")
  ) {
    const src =
      element.getAttribute(
        "src"
      ) || "";

    const alt =
      element.getAttribute(
        "alt"
      ) || "image";

    if (!src) {
      return "";
    }

    return (
      `![${alt}](${src})`
    );
  }

  const tag =
    element.tagName
      .toLowerCase();

  // ----------------------------------------------------------
  // Code block
  // ----------------------------------------------------------

  if (tag === "pre") {
    const code =
      element.querySelector(
        "code"
      ) ||
      element;

    const language =
      getCodeLanguage(
        element
      );

    const value =
      (
        code.textContent ||
        ""
      )
        .replace(
          /\r\n/g,
          "\n"
        )
        .replace(
          /\n$/,
          ""
        );

    return (
      "\n\n```" +
      language +
      "\n" +
      value +
      "\n```\n\n"
    );
  }

  // ----------------------------------------------------------
  // Inline code
  // ----------------------------------------------------------

  if (tag === "code") {
    const value =
      (
        element.textContent ||
        ""
      ).replace(
        /\r?\n/g,
        " "
      );

    const fence =
      value.includes("`")
        ? "``"
        : "`";

    return (
      fence +
      value +
      fence
    );
  }

  // ----------------------------------------------------------
  // Heading
  // ----------------------------------------------------------

  if (
    /^h[1-6]$/.test(
      tag
    )
  ) {
    const level =
      Number(
        tag.slice(1)
      );

    const value =
      serializeChildren(
        element,
        context
      ).trim();

    if (!value) {
      return "";
    }

    return (
      "\n\n" +
      "#".repeat(level) +
      " " +
      value +
      "\n\n"
    );
  }

  // ----------------------------------------------------------
  // Bold
  // ----------------------------------------------------------

  if (
    tag === "strong" ||
    tag === "b"
  ) {
    const value =
      serializeChildren(
        element,
        context
      ).trim();

    return value
      ? `**${value}**`
      : "";
  }

  // ----------------------------------------------------------
  // Italic
  // ----------------------------------------------------------

  if (
    tag === "em" ||
    tag === "i"
  ) {
    const value =
      serializeChildren(
        element,
        context
      ).trim();

    return value
      ? `*${value}*`
      : "";
  }

  // ----------------------------------------------------------
  // Strikethrough
  // ----------------------------------------------------------

  if (
    tag === "del" ||
    tag === "s"
  ) {
    const value =
      serializeChildren(
        element,
        context
      ).trim();

    return value
      ? `~~${value}~~`
      : "";
  }

  // ----------------------------------------------------------
  // Link
  // ----------------------------------------------------------

  if (tag === "a") {
    const label =
      serializeChildren(
        element,
        context
      ).trim();

    const href =
      element.getAttribute(
        "href"
      ) || "";

    if (!href) {
      return label;
    }

    return (
      `[${label || href}](${href})`
    );
  }

  // ----------------------------------------------------------
  // Line break
  // ----------------------------------------------------------

  if (tag === "br") {
    return "\n";
  }

  // ----------------------------------------------------------
  // Horizontal rule
  // ----------------------------------------------------------

  if (tag === "hr") {
    return "\n\n---\n\n";
  }

  // ----------------------------------------------------------
  // Blockquote
  // ----------------------------------------------------------

  if (
    tag ===
    "blockquote"
  ) {
    const value =
      serializeChildren(
        element,
        context
      )
        .trim()
        .split("\n")
        .map(
          (line) =>
            `> ${line}`
        )
        .join("\n");

    return value
      ? `\n\n${value}\n\n`
      : "";
  }

  // ----------------------------------------------------------
  // List
  // ----------------------------------------------------------

  if (
    tag === "ul" ||
    tag === "ol"
  ) {
    const value =
      serializeList(
        element,
        context
      );

    return value
      ? `\n\n${value}\n\n`
      : "";
  }

  // ----------------------------------------------------------
  // Table
  // ----------------------------------------------------------

  if (
    tag === "table"
  ) {
    const value =
      serializeTable(
        element,
        context
      );

    return value
      ? `\n\n${value}\n\n`
      : "";
  }

  // ----------------------------------------------------------
  // Paragraph
  // ----------------------------------------------------------

  if (tag === "p") {
    const value =
      serializeChildren(
        element,
        context
      ).trim();

    return value
      ? `\n\n${value}\n\n`
      : "";
  }

  // ----------------------------------------------------------
  // Generic container
  // ----------------------------------------------------------

  return serializeChildren(
    element,
    context
  );
}

// ============================================================
// Public Markdown extraction
// ============================================================

export function getElementMarkdown(
  element
) {
  if (!element) {
    return "";
  }

  /*
   * Prefer the semantic assistant Markdown root discovered
   * in the current ChatGPT DOM.
   */
  const markdownRoot =
    element.matches?.(
      '[data-markdown-text-style="assistant-message"]'
    )
      ? element
      : (
          element.querySelector?.(
            '[data-markdown-text-style="assistant-message"]'
          ) ||
          element
        );

  const markdown =
    Array.from(
      markdownRoot.childNodes
    )
      .map(
        (node) =>
          serializeMarkdownNode(
            node
          )
      )
      .join("");

  const normalized =
    normalizeMarkdownWhitespace(
      markdown
    );

  /*
   * Defensive fallback.
   *
   * If ChatGPT introduces an unknown DOM structure, returning
   * visible text is preferable to returning an empty response.
   */
  return (
    normalized ||
    getElementText(
      markdownRoot
    )
  );
}

// ============================================================
// Composer type
// ============================================================

export function getComposerType(
  composer
) {
  if (!composer) {
    return null;
  }

  const tagName =
    composer.tagName
      ?.toLowerCase();

  if (
    tagName === "textarea" ||
    tagName === "input"
  ) {
    return "input";
  }

  if (
    composer.getAttribute(
      "contenteditable"
    ) === "true"
  ) {
    return "contenteditable";
  }

  return "unknown";
}

// ============================================================
// Button state
// ============================================================

export function isButtonEnabled(
  button
) {
  if (!button) {
    return false;
  }

  if (!isVisible(button)) {
    return false;
  }

  if (button.disabled) {
    return false;
  }

  if (
    button.getAttribute(
      "aria-disabled"
    ) === "true"
  ) {
    return false;
  }

  return true;
}