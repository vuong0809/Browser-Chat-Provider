// src/providers/chatgpt/composer.js

import {
  findComposer,
  findSendButton,
  getComposerType,
  isButtonEnabled
} from "./selectors.js";


// ============================================================
// Timing
// ============================================================

const DEFAULT_TIMEOUT_MS = 10_000;

const POLL_INTERVAL_MS = 100;


// ============================================================
// Utilities
// ============================================================

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}


async function waitFor(
  condition,
  {
    timeout = DEFAULT_TIMEOUT_MS,
    interval = POLL_INTERVAL_MS
  } = {}
) {

  const startedAt =
    Date.now();


  while (
    Date.now() - startedAt <
    timeout
  ) {

    let result = null;


    try {
      result =
        await condition();
    } catch {
      result = null;
    }


    if (result) {
      return result;
    }


    await sleep(interval);
  }


  throw new Error(
    `Timeout after ${timeout} ms`
  );
}


// ============================================================
// Native value setter
// ============================================================

function setNativeInputValue(
  element,
  value
) {

  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;


  const descriptor =
    Object.getOwnPropertyDescriptor(
      prototype,
      "value"
    );


  if (
    descriptor &&
    typeof descriptor.set === "function"
  ) {

    descriptor.set.call(
      element,
      value
    );

  } else {

    element.value =
      value;
  }
}


// ============================================================
// Dispatch input events
// ============================================================

function dispatchInputEvents(
  element,
  text
) {

  /*
   * beforeinput is useful for editors that listen to modern
   * browser editing events.
   */
  try {

    element.dispatchEvent(
      new InputEvent(
        "beforeinput",
        {
          bubbles: true,
          cancelable: true,
          inputType:
            "insertText",
          data:
            text
        }
      )
    );

  } catch {
    // Some browser contexts may reject InputEvent options.
  }


  try {

    element.dispatchEvent(
      new InputEvent(
        "input",
        {
          bubbles: true,
          inputType:
            "insertText",
          data:
            text
        }
      )
    );

  } catch {

    element.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );
  }


  element.dispatchEvent(
    new Event(
      "change",
      {
        bubbles: true
      }
    )
  );
}


// ============================================================
// Textarea / input
// ============================================================

function setInputText(
  composer,
  text
) {

  composer.focus();


  setNativeInputValue(
    composer,
    text
  );


  dispatchInputEvents(
    composer,
    text
  );
}


// ============================================================
// contenteditable
// ============================================================

async function setContentEditableText(
  composer,
  text
) {
  composer.focus();

  // Select current editor contents.
  const selection =
    window.getSelection();

  const range =
    document.createRange();

  range.selectNodeContents(
    composer
  );

  selection.removeAllRanges();
  selection.addRange(range);

  // Remove existing content through the editor/browser pipeline.
  if (
    (
      composer.innerText ||
      composer.textContent ||
      ""
    ).trim()
  ) {
    document.execCommand(
      "delete",
      false
    );
  }

  composer.focus();

  // Build clipboard payload.
  const dataTransfer =
    new DataTransfer();

  dataTransfer.setData(
    "text/plain",
    text
  );

  // Let ProseMirror handle the paste itself.
  const pasteEvent =
    new ClipboardEvent(
      "paste",
      {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      }
    );

  const accepted =
    composer.dispatchEvent(
      pasteEvent
    );

  // Give React/ProseMirror one render cycle.
  await new Promise(
    resolve =>
      setTimeout(resolve, 100)
  );

  const actualText =
    (
      composer.innerText ||
      composer.textContent ||
      ""
    ).trim();

  console.log(
    "[ChatGPTComposer] ProseMirror paste",
    {
      expectedLength: text.length,
      actualLength: actualText.length,
      accepted,
      defaultPrevented:
        pasteEvent.defaultPrevented
    }
  );

  if (!actualText) {
    throw new Error(
      "ChatGPT ProseMirror did not accept pasted text"
    );
  }
}


// ============================================================
// Public: set composer text
// ============================================================

export async function setComposerText(
  text,
  {
    timeout =
    DEFAULT_TIMEOUT_MS
  } = {}
) {

  if (
    typeof text !== "string" ||
    !text.trim()
  ) {

    throw new Error(
      "Composer text is required"
    );
  }


  const composer =
    await waitFor(
      () => findComposer(),
      {
        timeout
      }
    );

  console.log(
    "[ChatGPTComposer] Composer found",
    {
      tagName:
        composer.tagName,

      type:
        getComposerType(
          composer
        ),

      contentEditable:
        composer.getAttribute(
          "contenteditable"
        ),

      role:
        composer.getAttribute(
          "role"
        ),

      id:
        composer.id || null
    }
  );
  const type =
    getComposerType(
      composer
    );


  switch (type) {

    case "input":

      setInputText(
        composer,
        text
      );

      break;


    case "contenteditable":

      setContentEditableText(
        composer,
        text
      );

      break;


    default:

      throw new Error(
        "Unsupported ChatGPT composer type"
      );
  }


  /*
   * Give ChatGPT/React a short opportunity to process the
   * input event and update send-button state.
   */

  console.log(
    "[ChatGPTComposer] Text applied",
    {
      expectedLength:
        text.length,

      actualLength:
        getComposerText().length,

      hasText:
        Boolean(
          getComposerText()
        )
    }
  );
  await sleep(50);


  return composer;
}


// ============================================================
// Public: get composer text
// ============================================================

export function getComposerText() {

  const composer =
    findComposer();


  if (!composer) {
    return "";
  }


  const type =
    getComposerType(
      composer
    );


  if (type === "input") {

    return (
      composer.value ||
      ""
    ).trim();
  }


  if (
    type ===
    "contenteditable"
  ) {

    return (
      composer.innerText ||
      composer.textContent ||
      ""
    ).trim();
  }


  return "";
}


// ============================================================
// Public: clear composer
// ============================================================

export async function clearComposer() {

  const composer =
    findComposer();


  if (!composer) {
    return false;
  }


  const type =
    getComposerType(
      composer
    );


  if (type === "input") {

    setInputText(
      composer,
      ""
    );

  } else if (
    type === "contenteditable"
  ) {

    composer.replaceChildren();

    dispatchInputEvents(
      composer,
      ""
    );

  } else {

    return false;
  }


  return true;
}


// ============================================================
// Wait for send button
// ============================================================

export async function waitForSendButton({
  timeout =
  DEFAULT_TIMEOUT_MS
} = {}) {

  const startedAt =
    Date.now();

  let lastButton =
    null;

  while (
    Date.now() - startedAt <
    timeout
  ) {

    const button =
      findSendButton();

    if (button) {

      lastButton =
        button;

      if (
        isButtonEnabled(
          button
        )
      ) {

        console.log(
          "[ChatGPTComposer] Send button ready",
          {
            type:
              button.getAttribute(
                "type"
              ),

            ariaLabel:
              button.getAttribute(
                "aria-label"
              ),

            testId:
              button.getAttribute(
                "data-testid"
              ),

            disabled:
              button.disabled,

            ariaDisabled:
              button.getAttribute(
                "aria-disabled"
              )
          }
        );

        return button;
      }
    }


    await sleep(
      POLL_INTERVAL_MS
    );
  }


  console.error(
    "[ChatGPTComposer] Send button timeout",
    {
      composerFound:
        Boolean(
          findComposer()
        ),

      composerLength:
        getComposerText().length,

      buttonFound:
        Boolean(
          lastButton
        ),

      button:
        lastButton
          ? {
            type:
              lastButton.getAttribute(
                "type"
              ),

            ariaLabel:
              lastButton.getAttribute(
                "aria-label"
              ),

            testId:
              lastButton.getAttribute(
                "data-testid"
              ),

            disabled:
              lastButton.disabled,

            ariaDisabled:
              lastButton.getAttribute(
                "aria-disabled"
              )
          }
          : null
    }
  );


  throw new Error(
    `Send button timeout after ${timeout} ms`
  );
}

// ============================================================
// Public: submit
// ============================================================
export async function submitComposer({
  timeout =
  DEFAULT_TIMEOUT_MS,

  confirmationTimeout =
  1_000
} = {}) {

  const composer =
    findComposer();


  if (!composer) {

    throw new Error(
      "ChatGPT composer not found"
    );
  }


  if (!getComposerText()) {

    throw new Error(
      "ChatGPT composer is empty"
    );
  }


  // ----------------------------------------------------------
  // Find real Send button
  // ----------------------------------------------------------

  const button =
    await waitForSendButton({
      timeout
    });


  console.log(
    "[ChatGPTComposer] Clicking send button",
    {
      type:
        button.getAttribute(
          "type"
        ),

      ariaLabel:
        button.getAttribute(
          "aria-label"
        ),

      testId:
        button.getAttribute(
          "data-testid"
        )
    }
  );


  // ----------------------------------------------------------
  // Click real button
  // ----------------------------------------------------------

  button.click();


  /*
   * IMPORTANT
   *
   * button.click() is the actual submission action.
   *
   * Composer clearing is only a secondary confirmation.
   * ChatGPT can start POST /backend-api/f/conversation
   * before/without our DOM-based composer check observing
   * an empty value.
   *
   * NetworkResponseBridge provides the authoritative
   * confirmation later.
   */


  let composerCleared =
    false;


  try {

    await waitFor(
      () =>
        getComposerText() === "",
      {
        timeout:
          confirmationTimeout,

        interval:
          50
      }
    );


    composerCleared =
      true;

  } catch {

    /*
     * Do NOT fail the request.
     *
     * The click has already happened. Network SSE or the
     * response observer will determine whether ChatGPT
     * accepted it.
     */

    console.debug(
      "[ChatGPTComposer] Composer clear confirmation not observed; continuing with response confirmation"
    );
  }


  console.log(
    "[ChatGPTComposer] Send button clicked",
    {
      composerCleared
    }
  );


  return {
    submitted: true,

    method:
      "button",

    composerCleared,

    /*
     * This means:
     *
     * "The real Send button was clicked."
     *
     * It does NOT claim that ChatGPT's backend has
     * accepted the request yet.
     */

    confirmation:
      composerCleared
        ? "composer-cleared"
        : "response-pending"
  };
}

// ============================================================
// Combined helper
// ============================================================
export async function sendComposerMessage(
  text,
  options = {}
) {

  if (
    typeof text !== "string" ||
    !text.trim()
  ) {

    throw new Error(
      "Composer text is required"
    );
  }


  // ----------------------------------------------------------
  // ChatGPT uses ProseMirror.
  //
  // Do NOT mutate the contenteditable DOM and do NOT dispatch
  // synthetic paste/input events here.
  //
  // Browser-level text input is performed by the background
  // service worker through Chrome DevTools Protocol:
  //
  //     Runtime.evaluate -> focus ProseMirror
  //     Input.insertText -> browser-native editor input
  //
  // This makes ChatGPT/ProseMirror update its real editor state.
  // ----------------------------------------------------------

  let response = null;


  try {

    response =
      await chrome.runtime.sendMessage({
        type:
          "browser-chat.cdp-input",

        text
      });

  } catch (error) {

    console.warn(
      "[ChatGPTComposer] CDP input unavailable; falling back to DOM input:",
      error
    );


    await setComposerText(
      text,
      options
    );


    return submitComposer(
      options
    );
  }


  if (!response?.ok) {

    const errorMessage =
      response?.error ||
      "CDP composer input failed";


    if (
      errorMessage.includes(
        "chrome.debugger unavailable"
      ) ||
      errorMessage.includes(
        "Cannot read properties of undefined (reading 'attach')"
      )
    ) {

      console.warn(
        "[ChatGPTComposer] CDP input unsupported; falling back to DOM input"
      );


      await setComposerText(
        text,
        options
      );


      return submitComposer(
        options
      );
    }

    throw new Error(
      errorMessage
    );
  }


  const result =
    response.result ||
    {};


  console.log(
    "[ChatGPTComposer] CDP input completed",
    {
      composerFound:
        result.composerFound,

      textLength:
        typeof result.text === "string"
          ? result.text.length
          : undefined,

      sendButtonFound:
        result.sendButtonFound,

      sendButtonLabel:
        result.sendButtonLabel
    }
  );


  // ----------------------------------------------------------
  // The Send button is a stronger indication than DOM text
  // length that ProseMirror/ChatGPT accepted the input.
  // ----------------------------------------------------------

  if (
    result.composerFound === false
  ) {

    throw new Error(
      "ChatGPT composer not found after CDP input"
    );
  }


  if (
    result.sendButtonFound === false
  ) {

    throw new Error(
      "ChatGPT did not enable Send after CDP input"
    );
  }


  return submitComposer(
    options
  );
}
