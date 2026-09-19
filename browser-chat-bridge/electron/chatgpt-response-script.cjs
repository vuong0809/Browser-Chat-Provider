function chatGPTResponseScript(timeoutMs) {
    return (async () => {
        const startedAt = Date.now();

        const sleep = (ms) =>
            new Promise(
                resolve => setTimeout(resolve, ms)
            );

        function getText(element) {
            return (
                element?.innerText ||
                element?.textContent ||
                ""
            ).trim();
        }

        function getAssistantTexts() {
            const selectors = [
                '[data-message-author-role="assistant"]',
                '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
            ];

            const nodes =
                Array.from(
                    document.querySelectorAll(
                        selectors.join(",")
                    )
                );

            return nodes
                .map(getText)
                .filter(Boolean);
        }
        function getLastConversationTurn() {
            const turns =
                Array.from(
                    document.querySelectorAll(
                        '[data-testid^="conversation-turn-"]'
                    )
                );

            const element =
                turns.at(-1) || null;

            return {
                element,
                id:
                    element?.getAttribute(
                        "data-testid"
                    ) || null
            };
        }
        function getResponseDiagnostics() {
            const roleNodes =
                Array.from(
                    document.querySelectorAll(
                        '[data-message-author-role="assistant"]'
                    )
                );

            const turnNodes =
                Array.from(
                    document.querySelectorAll(
                        '[data-testid^="conversation-turn-"]'
                    )
                );

            const nestedAssistantNodes =
                Array.from(
                    document.querySelectorAll(
                        '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
                    )
                );

            const lastRoleNode =
                roleNodes.at(-1) || null;

            const lastTurn =
                turnNodes.at(-1) || null;

            const lastTurnAssistant =
                lastTurn?.querySelector(
                    '[data-message-author-role="assistant"]'
                ) || null;

            return {
                roleNodeCount:
                    roleNodes.length,

                nestedAssistantCount:
                    nestedAssistantNodes.length,

                turnCount:
                    turnNodes.length,

                lastRoleTextLength:
                    getText(lastRoleNode).length,

                lastTurnTextLength:
                    getText(lastTurn).length,

                lastTurnAssistantTextLength:
                    getText(lastTurnAssistant).length,

                lastTurnTestId:
                    lastTurn?.getAttribute(
                        "data-testid"
                    ) || null,

                lastTurnHasAssistant:
                    Boolean(lastTurnAssistant)
            };
        }
        function findComposer() {
            return (
                document.querySelector(
                    'div.ProseMirror[contenteditable="true"]'
                ) ||
                document.querySelector(
                    '[contenteditable="true"][role="textbox"]'
                ) ||
                document.querySelector("textarea") ||
                document.querySelector(
                    '[contenteditable="true"]'
                )
            );
        }

        function findSendButton() {
            const buttons =
                Array.from(
                    document.querySelectorAll("button")
                );

            return (
                document.querySelector(
                    '[data-testid="send-button"]'
                ) ||
                buttons.find(
                    button =>
                        /send|submit/i.test(
                            button.getAttribute("aria-label") ||
                            button.textContent ||
                            ""
                        )
                )
            );
        }

        async function waitFor(
            condition,
            label
        ) {
            while (
                Date.now() - startedAt <
                timeoutMs
            ) {
                const value =
                    condition();

                if (value) {
                    return value;
                }

                await sleep(250);
            }

            throw new Error(
                "Timed out waiting for " +
                label
            );
        }

        // Snapshot response before sending.
        const beforeTexts =
            getAssistantTexts();

        const beforeLast =
            beforeTexts.at(-1) || "";

        const beforeTurn =
            getLastConversationTurn();

        const beforeTurnId =
            beforeTurn.id;

        // Input was already performed by
        // insertPromptWithCDP(content).
        await waitFor(
            findComposer,
            "ChatGPT composer"
        );

        // Wait until ChatGPT exposes its real Send button.
        console.log(
            "[Electron][ChatGPT] Waiting for enabled Send button"
        );

        console.log(
            "[Electron][ChatGPT] Conversation snapshot " +
            JSON.stringify({
                beforeTurnId,
                beforeAssistantCount:
                    beforeTexts.length,
                beforeLastLength:
                    beforeLast.length
            })
        );

        const sendButton =
            await waitFor(
                () => {
                    const button =
                        findSendButton();

                    if (
                        !button ||
                        button.disabled ||
                        button.getAttribute(
                            "aria-disabled"
                        ) === "true"
                    ) {
                        return null;
                    }

                    return button;
                },
                "enabled send button"
            );

        console.log(
            "[Electron][ChatGPT] Send button ready",
            {
                testId:
                    sendButton.getAttribute(
                        "data-testid"
                    ),
                ariaLabel:
                    sendButton.getAttribute(
                        "aria-label"
                    ),
                disabled:
                    Boolean(sendButton.disabled)
            }
        );

        sendButton.click();

        console.log(
            "[Electron][ChatGPT] Send clicked"
        );

        let lastText = "";
        let stableCount = 0;
        let generationLogged = false;
        let responseLogged = false;
        let lastDiagnosticSignature = "";

        while (
            Date.now() - startedAt <
            timeoutMs
        ) {
            await sleep(1000);

            const texts =
                getAssistantTexts();

            const current =
                texts.at(-1) || "";

            const currentTurn =
                getLastConversationTurn();

            const currentTurnId =
                currentTurn.id;

            const hasNewTurn =
                Boolean(
                    currentTurnId &&
                    currentTurnId !==
                    beforeTurnId
                );

            const currentTurnAssistant =
                hasNewTurn
                    ? currentTurn.element?.querySelector(
                        '[data-message-author-role="assistant"]'
                    ) || null
                    : null;

            const currentTurnText =
                getText(
                    currentTurnAssistant
                );

            const diagnostics =
                getResponseDiagnostics();

            const diagnosticState = {
                ...diagnostics,

                beforeTurnId,
                currentTurnId,
                hasNewTurn,

                assistantCount:
                    texts.length,

                currentLength:
                    current.length,

                currentTurnTextLength:
                    currentTurnText.length,

                beforeLastLength:
                    beforeLast.length,

                newTurnHasResponse:
                    Boolean(
                        hasNewTurn &&
                        currentTurnText
                    ),

                stableCount
            };

            const diagnosticSignature =
                JSON.stringify(
                    diagnosticState
                );

            if (
                diagnosticSignature !==
                lastDiagnosticSignature
            ) {
                lastDiagnosticSignature =
                    diagnosticSignature;

                console.log(
                    "[Electron][ChatGPT] Response diagnostic " +
                    JSON.stringify(diagnosticState)
                );
            }
            // Detect whether ChatGPT is still generating.
            const stopButton =
                Array.from(
                    document.querySelectorAll(
                        "button"
                    )
                ).find(
                    button =>
                        /stop/i.test(
                            button.getAttribute(
                                "aria-label"
                            ) ||
                            button.textContent ||
                            ""
                        )
                );

            // Diagnostic: log only when Stop state changes.
            const stopState =
                Boolean(stopButton);

            if (
                stopState !==
                window.__browserChatLastStopState
            ) {
                window.__browserChatLastStopState =
                    stopState;

                console.log(
                    "[Electron][ChatGPT] Stop button state " +
                    JSON.stringify({
                        found: stopState,
                        ariaLabel:
                            stopButton?.getAttribute(
                                "aria-label"
                            ) || null,
                        text:
                            (
                                stopButton?.textContent ||
                                ""
                            )
                                .trim()
                                .slice(0, 100)
                    })
                );
            }

            if (
                stopButton &&
                !generationLogged
            ) {
                generationLogged = true;

                console.log(
                    "[Electron][ChatGPT] Generation started"
                );
            }

            const changed =
                Boolean(
                    hasNewTurn &&
                    currentTurnText
                );

            if (
                changed &&
                !responseLogged
            ) {
                responseLogged = true;

                console.log(
                    "[Electron][ChatGPT] Assistant response detected",
                    {
                        turnId:
                            currentTurnId,
                        contentLength:
                            currentTurnText.length,
                        assistantCount:
                            texts.length
                    }
                );
            }

            if (!changed) {
                continue;
            }

            if (
                currentTurnText ===
                lastText
            ) {
                stableCount += 1;
            } else {
                stableCount = 0;
                lastText =
                    currentTurnText;
            }

            if (
                stableCount >= 2 &&
                !stopButton
            ) {
                const conversationId =
                    location.pathname
                        .match(
                            /\/c\/([^/?#]+)/
                        )?.[1] ||
                    null;

                console.log(
                    "[Electron][ChatGPT] Response completed",
                    {
                        turnId:
                            currentTurnId,
                        contentLength:
                            currentTurnText.length,
                        stableCount,
                        durationMs:
                            Date.now() -
                            startedAt,
                        conversationId
                    }
                );

                return {
                    content:
                        currentTurnText,

                    title:
                        document.title ||
                        null,

                    conversationId
                };
            }
        }

        throw new Error(
            "Timed out waiting for ChatGPT response"
        );
    })();
}

module.exports = {
    chatGPTResponseScript
};