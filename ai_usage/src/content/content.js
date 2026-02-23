// ================== AI Usage Meter – ChatGPT detector ==================

// --- Utility: wait for element by selector --------------------------------
function waitForElement(selector, callback) {
    const el = document.querySelector(selector);
    if (el) {
        callback(el);
        return;
    }

    const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
            observer.disconnect();
            callback(el);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// --- ChatGPT detector ------------------------------------------------------
function detectChatGPT(onPrompt) {
    console.log("[AI Usage Meter] ChatGPT detector active on", location.hostname);

    // ChatGPT now uses a ProseMirror contenteditable div with id="prompt-textarea"
    waitForElement("#prompt-textarea", editor => {
        console.log("[AI Usage Meter] ChatGPT editor found:", editor);

        // Messages live under <main> (more stable than old data-testid selectors)
        waitForElement("main", chatContainer => {
            console.log("[AI Usage Meter] ChatGPT chat container found:", chatContainer);

            setupChatGPTListeners(editor, chatContainer, onPrompt);
        });
    });
}

// --- Main logic once editor + chat container exist -------------------------
function setupChatGPTListeners(editor, chatContainer, onPrompt) {
    const sendButton = document.querySelector('[data-testid="send-button"]');
    console.log("[AI Usage Meter] Send button:", sendButton);

    function handleSubmit() {
        // ProseMirror content: use innerText
        const text = editor.innerText.trim();
        if (!text) return;

        console.log("[AI Usage Meter] handleSubmit, text:", text);
// analyse text to determine what kind of prompt it was and adjust accordingly
        const model = getChatGPTModel();
        const tokensIn = estimateTokens(text);
        const conversationId = getConversationId();
        const promptStartTime = performance.now();

        const observer = new MutationObserver(() => {
            const response = getLastAssistantMessage();

            // Ignore empty or placeholder messages
            if (!response || response.length < 3) return;

            const tokensOut = estimateTokens(response);
            const latencyMs = performance.now() - promptStartTime;

            onPrompt({
                source: "chatgpt",
                model,
                tokens_in: tokensIn,
                tokens_out: tokensOut,
                characters_in: text.length,
                characters_out: response.length,
                latency_ms: latencyMs,
                conversation_id: conversationId,
                timestamp: new Date().toISOString()
            });

            observer.disconnect();
        });

        observer.observe(chatContainer, { childList: true, subtree: true });
    }

    // Enter-to-send inside the ProseMirror editor
    document.addEventListener("keydown", e => {
        if (!e.target.closest("#prompt-textarea")) return;
        if (e.key === "Enter" && !e.shiftKey) {
            // Let ChatGPT handle the actual send, we just observe
            handleSubmit();
        }
    });

    // Click on send button
    if (sendButton) {
        sendButton.addEventListener("click", handleSubmit);
    }
}

// --- Helpers ---------------------------------------------------------------
function getChatGPTModel() {
    const modelEl = document.querySelector('[data-testid="model-switcher-dropdown-button"]');
    if (modelEl) return modelEl.innerText.trim();

    // Fallback: look for any element containing "GPT"
    const guess = [...document.querySelectorAll("*")]
        .map(e => e.innerText)
        .find(t => t && t.match(/GPT/i));
    return guess || null;
}

function estimateTokens(text) {
    if (!text) return 0;
    const words = text.trim().split(/\s+/).length;
    return Math.round(words * 1.3);
}

function getLastAssistantMessage() {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (!msgs.length) return null;
    return msgs[msgs.length - 1].innerText.trim();
}

function getConversationId() {
    // 1. Check meta tag (most reliable)
    const meta = document.querySelector('meta[name="oai-conversation-id"]');
    if (meta?.content) return meta.content;

    // 2. Check Next.js global data
    try {
        const next = window.__NEXT_DATA__;
        const id = next?.props?.pageProps?.conversationId;
        if (id) return id;
    } catch (e) { }

    // 3. Fallback: old URL format
    const match = location.pathname.match(/\/c\/([a-z0-9-]+)/i);
    if (match) return match[1];

    return null;
}

// ================== Global detector registry ================================
window.AIUsageDetectors = {
    detectChatGPT,
};

// ================== Init detectors =========================================
function initDetectors() {
    console.log("[AI Usage Meter] Content script loaded on", location.hostname);

    const onPrompt = (payload) => {
        console.log("[AI Usage Meter] Prompt event received:", payload);

        chrome.runtime.sendMessage({
            type: "PROMPT_EVENT",
            payload
        });
    };

    const { detectChatGPT } = window.AIUsageDetectors;
    detectChatGPT(onPrompt);
}

if (document.readyState === "complete" || document.readyState === "interactive") {
    initDetectors();
} else {
    window.addEventListener("DOMContentLoaded", initDetectors);
}