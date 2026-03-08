// Modern AI Usage Meter – ChatGPT detector (ES6+ with working Chrome messaging)
// COMPLETE WORKING VERSION
class ChatGPTDetector {
    constructor() {
        // initialized as null first
        this.userId = null;
        this.sessionId = null;
        this.sessionStart = null;
        this.sessionPromptCount = null;
        this.timeSinceLastPrompt = null;
        this.extensionVersion = null;

        this.lastRegenerateUsed = false;
        this.lastSuggestedPromptUsed = false;
        this.schemaVersion = 1;
        // this means init() is called even before constructor finishes
        // this also means init() is always called when a new instance of ChatGPTDetector is created
        this.init();
    }

    init() {
        // this sends a message to the background with payload "GET_IDENTIFIERS"
        // it gets response in return
        chrome.runtime.sendMessage({ type: "GET_IDENTIFIERS" }, (response) => {
            // safety precaution incase there is no response, cancel early
            if (chrome.runtime.lastError) {
                console.error("[AI Usage Meter] Error getting identifiers:", chrome.runtime.lastError);
                return;
            }
            // this destructures the variables out of response
            //  '|| {}' means if there is no response fallback to empty object
            const {
                user_id: userId,
                session_id: sessionId,
                session_start: sessionStart,
                session_prompt_count: sessionPromptCount,
                time_since_last_prompt: timeSinceLastPrompt,
                extension_version: extensionVersion
            } = response || {};

            // populate the null properties from the constructor
            // with Object.assign we avoid writing 6 lines of this.userid = userid etc etc.
            // Object.assign(TARGET, SOURCE1, SOURCE2, etc)
            Object.assign(this, {
                userId, sessionId, sessionStart, sessionPromptCount,
                timeSinceLastPrompt, extensionVersion
            });

            console.log("[AI Usage Meter] Initialized with user:", this.userId);
            // if all went well, start detecting
            this.startDetection();
        });
    }

    // this waits 30 seconds for an element to appear in the DOM == "Polling"
    // reusable for whatever element
    waitForElement(selector, timeout = 30000) {
        // resolve and reject are needed to handle a promise, can't use a normal return
        return new Promise((resolve, reject) => {
            const start = Date.now();
            // The actual polling function
            const check = () => {
                // Look for the element
                const element = document.querySelector(selector);
                // if it is found, resolve the promise and return the element
                if (element) {
                    resolve(element);
                    return;
                }
                // if 30 seconds have passed, fails
                if (Date.now() - start > timeout) {
                    reject(new Error(`Element ${selector} not found within ${timeout}ms`));
                    return;
                }
                // Nothing was found, but try again in 100ms
                setTimeout(check, 100);
            };
            // call the polling function
            check();
        });
    }

    async startDetection() {
        // try catch because finding elements can fail
        try {
            console.log("[AI Usage Meter] Starting detection on", location.hostname);

            // first wait for the critical elements
            const editor = await this.waitForElement("#prompt-textarea");
            const chatContainer = await this.waitForElement("main");

            // if the elements were found, set up the listeners on said elements 
            console.log("[AI Usage Meter] Editor and container found");
            this.setupListeners(editor, chatContainer);

        } catch (error) {
            console.error("[AI Usage Meter] Detection setup failed:", error);
        }
    }

    setupListeners(editor, chatContainer) {
        // a wrapper is needed because this function must be called by an eventlistener
        // without the wrapper, an event object would be added to the parameters, breaking the function
        // it also needs to be an arrow function to preserve the THIS context
        const handleSubmit = () => this.handleSubmit(editor, chatContainer);

        // Enter-to-send
        document.addEventListener("keydown", (e) => {
            // this tracks if the user is typing in the chatGPT textarea, not somewhere else
            if (e.target.closest("#prompt-textarea") &&
                // and presses enter without shift
                e.key === "Enter" && !e.shiftKey) {
                // if so, call handlesubmit
                handleSubmit();
            }
            // true here (useCapture: true) gives high priorty to our event, making it fire before chatGPT can do anything
        }, true);

        // Send button
        const sendButton = document.querySelector('[data-testid="send-button"]');
        if (sendButton) {
            sendButton.addEventListener("click", handleSubmit);
        }
        // watch for these buttons/prompts
        this.trackRegenerate();
        this.trackSuggestedPrompts();
    }

    trackRegenerate() {
        // a MutationObserver watches for DOM changes
        const observer = new MutationObserver(() => {
            // try three options to find the button
            const regenerateButton = document.querySelector('[data-testid="regenerate"]') ||
                document.querySelector('[data-string-id="regenerate"]') ||
                document.querySelector('button[aria-label*="regenerate"]');

            // if it found a button, and it is new (the '!' means false == it wasn't being tracked yet)
            if (regenerateButton && !regenerateButton.dataset.tracked) {
                // now it is being tracked
                regenerateButton.dataset.tracked = 'true';
                regenerateButton.addEventListener('click', () => {
                    // set the variable to true for 5 seconds
                    this.lastRegenerateUsed = true;
                    console.log("[AI Usage Meter] Regenerate used");
                    setTimeout(() => {
                        this.lastRegenerateUsed = false;
                    }, 5000);
                    // a one time eventlistener
                }, { once: true });
            }
        });
        // this means the observer is watching everything
        observer.observe(document.body, { childList: true, subtree: true });
    }

    trackSuggestedPrompts() {
        // watching the DOM constantly, not just once
        const observer = new MutationObserver(() => {
            const suggestButtons = document.querySelectorAll(
                '[data-testid="accept-prompt"], ' +
                'button[data-string-id*="optimize"], ' +
                'button[aria-label*="suggestion"], ' +
                'button[aria-label*="Suggested"]'
            );
            // loops over any button that might have been found
            for (const button of suggestButtons) {
                if (!button.dataset.tracked) {
                    // does basically the same thing as track regenerate does
                    button.dataset.tracked = 'true';
                    button.addEventListener('click', () => {
                        this.lastSuggestedPromptUsed = true;
                        console.log("[AI Usage Meter] Suggested prompt used");
                        setTimeout(() => {
                            this.lastSuggestedPromptUsed = false;
                        }, 5000);
                    }, { once: true });
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }
    // estimates the number of tokens based on text length
    estimateTokens(text) {
        if (!text || typeof text !== 'string') return 0;

        const charCount = text.length;
        const avgCharsPerToken = 3.8; // Empirical average from OpenAI tokenizer
        const estimatedTokens = Math.ceil(charCount / avgCharsPerToken);

        return Math.max(1, Math.min(estimatedTokens, 100000));
    }

    async handleSubmit(editor, chatContainer) {
        // the '?' prevents a crash incase it returns null or undefined
        const text = editor.innerText?.trim();
        if (!text) return;

        console.log("[AI Usage Meter] Processing prompt");

        // Pre-calculate all metrics
        const model = this.getChatGPTModel();
        const tokensIn = this.estimateTokens(text);
        const conversationId = this.getConversationId();
        const promptStartTime = performance.now();

        const modelMode = this.detectModelMode();
        const promptType = this.classifyPrompt(text);
        const promptLanguage = this.detectLanguage(text);
        const promptDomain = this.detectDomain(text);
        const safetyCategory = this.classifySafety(text);
        const messageIndex = this.getUserMessageIndex();
        const conversationLength = this.getConversationLength();
        const isFollowup = this.detectFollowup(text);

        const sessionMetrics = {
            session_id: this.sessionId,
            session_start: new Date(this.sessionStart).toISOString(),
            session_prompt_count: this.sessionPromptCount,
            session_duration_ms: Date.now() - this.sessionStart,
            time_since_last_prompt_ms: this.timeSinceLastPrompt
        };

        const uiSignals = {
            regenerate_used: this.lastRegenerateUsed,
            suggested_prompt_used: this.lastSuggestedPromptUsed,
            image_attached: this.hasImageAttachment(),
            file_attached: this.hasFileAttachment(),
            voice_input: this.isVoiceInputActive(),
            tool_active: this.isToolActive()
        };

        // Reset flags BEFORE tracking response
        this.lastRegenerateUsed = false;
        this.lastSuggestedPromptUsed = false;

        // Track response completion
        // response and streamingDurationMS are returned from trackResponse
        // trackResponse fires first, going into the text observing loop
        // only when it is finished does it go on to creating the const event
        // this ensures we have the full response before proceeding
        this.trackResponse(chatContainer, promptStartTime, (response, streamingDurationMs) => {
            const event = {
                schema_version: this.schemaVersion,
                timestamp: new Date().toISOString(),
                user: { user_id: this.userId },
                session: sessionMetrics,
                prompt: {
                    text_length: text.length,
                    tokens_in: tokensIn,
                    prompt_type: promptType,
                    domain: promptDomain,
                    language: promptLanguage,
                    is_followup: isFollowup,
                    message_index: messageIndex,
                    conversation_length: conversationLength,
                    safety_category: safetyCategory,
                    timestamp: new Date().toISOString()
                },
                response: {
                    tokens_out: this.estimateTokens(response),
                    characters_out: response.length,
                    latency_ms: performance.now() - promptStartTime,
                    streaming_duration_ms: streamingDurationMs
                },
                model: { model_name: model, model_mode: modelMode },
                ui_interaction: uiSignals,
                environment: this.getClientEnvironment(),
                source: "chatgpt",
                conversation_id: conversationId
            };

            chrome.runtime.sendMessage({
                type: "PROMPT_EVENT",
                payload: event
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("[AI Usage Meter] Failed to send event:", chrome.runtime.lastError);
                } else {
                    console.log("[AI Usage Meter] Event sent successfully");
                }
            });
        });
    }
    // chatContainer is still the original we measured back in the original setup
    trackResponse(chatContainer, promptStartTime, callback) {
        let endTimer = null;
        // previous response text
        let lastContent = "";
        // A DOM watcher
        const observer = new MutationObserver(() => {
            // This fires every time chatGPT adds text to response
            const response = this.getLastAssistantMessage();
            // ignores junk messages
            if (!response || response.length < 3) return;

            // this fires if new text has appeared
            if (response !== lastContent) {
                lastContent = response;
                // and then removes it's own timeout
                if (endTimer) {
                    clearTimeout(endTimer);
                }
                // and creates a new one
                endTimer = setTimeout(() => {
                    // this will fire if 300ms were allowed to pass
                    observer.disconnect();
                    const streamingDurationMs = performance.now() - promptStartTime;
                    // and sends the completed response, plus the time elapsed to the callback
                    callback(response, streamingDurationMs);
                }, 300);
            }
        });

        observer.observe(chatContainer, { childList: true, subtree: true });
    }

    // ALL HELPER METHODS - COMPLETE IMPLEMENTATION

    getLastAssistantMessage() {
        const selectors = [
            '[data-message-author-role="assistant"]:last-child [data-message-preview]',
            '[data-message-author-role="assistant"]:last-child',
            '.text-base:last-child',
            '[class*="assistant"]:last-child'
        ];
        // this tries every selector written above, to look for the last message written by chatGPT
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                // grabs the last element in the NodeList, and tries to read its text content
                const last = elements[elements.length - 1];
                return last.innerText?.trim() || last.textContent?.trim() || '';
            }
        }
        // if all fails, return an empty string
        return '';
    }
    // /////model name is not working well
    // getChatGPTModel() {
    //     const selectors = [
    //         '[data-testid="model-switcher-dropdown-button"]',
    //         '[data-testid="model-switcher-dropdown"] *'
    //     ];

    //     for (const selector of selectors) {
    //         // loop through all the selectors looking for where the model name is stored
    //         const elements = document.querySelectorAll(selector);
    //         for (const el of elements) {
    //             // trim the whitespace
    //             const cleaned = this.normalizeModelName(el.innerText?.trim());
    //             // if it existed, return it
    //             if (cleaned) return cleaned;
    //         }
    //     }

    //     const knownModels = ["gpt-4o", "gpt-4o-mini", "gpt-4", "gpt-3.5-turbo", "o1", "o1-mini"];
    //     const pageText = document.body.innerText.toLowerCase();
    //     // this is a less refined way of finding the model name, incase attempt one failed
    //     // scan all the text on the page looking for a model name
    //     // return it if it matches anything in knownModels
    //     for (const model of knownModels) {
    //         if (pageText.includes(model)) return model;
    //     }
    //     // otherwise return nothing
    //     return "unknown";
    // }
    // // helper to normalize a model name
    // normalizeModelName(text) {
    //     if (!text) return null;
    //     // in lowercase to normalize any possible case
    //     const lower = text.toLowerCase();

    //     const patterns = {
    //         "gpt-4o mini": "gpt-4o-mini",
    //         "gpt-4o": "gpt-4o",
    //         "gpt-4": "gpt-4",
    //         "gpt-3.5": "gpt-3.5-turbo",
    //         "o1-mini": "o1-mini",
    //         "o1": "o1"
    //     };
    //     // this is like dict comprehensions
    //     // Object.entries(patterns) returns the key-value pairs of patterns
    //     // [pattern, normalized] unpacks the key-value pair into pattern and normalized
    //     // so it checks for each key if it is in the text, and if so, returns its value
    //     for (const [pattern, normalized] of Object.entries(patterns)) {
    //         if (lower.includes(pattern)) return normalized;
    //     }
    //     // returns nothing if fails
    //     return null;
    // }
    // // looks at the url to decide what mode the model is in
    // detectModelMode() {
    //     const url = location.pathname;
    //     if (url.includes('/code')) return 'code-interpreter';
    //     if (url.includes('/chat')) return 'chat';
    //     return 'standard';
    // }

    getChatGPTModel() {
        // 1. Enhanced __NEXT_DATA__ parse (deeper props)
        try {
            if (window.__NEXT_DATA__) {
                const data = window.__NEXT_DATA__.props?.pageProps;
                const paths = ['model', 'initialModel', 'conversation.model', 'currentModel', 'activeModel'];
                for (const path of paths) {
                    let val = data;
                    for (const key of path.split('.')) val = val?.[key];
                    if (val) return this.normalizeModelName(val);
                }
            }
        } catch (e) {
            console.warn("Failed __NEXT_DATA__", e);
        }

        // 2. Expanded selectors (model button, dropdown items, active indicators)
        const selectors = [
            '[data-testid="model-switcher-dropdown-button"]',
            '[data-testid^="model-switcher-"]',
            '[data-testid="model-switcher-dropdown"] *',
            '.model-selector-active',  // Common active class
            '[aria-label*="model"], [title*="model"]'
        ];
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                const text = el.innerText?.trim() || el.title?.trim() || el.dataset.model;
                const cleaned = this.normalizeModelName(text);
                if (cleaned) return cleaned;
            }
        }

        // 3. Updated known models + page scan fallback
        const knownModels = ["gpt-5", "gpt-5.4", "gpt-5.2", "gpt-4o", "gpt-4o-mini", "gpt-4", "gpt-3.5-turbo", "o1", "o1-mini", "gpt-5-thinking", "gpt-5-t-mini"];
        const pageText = document.body.innerText.toLowerCase();
        for (const model of knownModels) {
            if (pageText.includes(model.toLowerCase())) return model;
        }

        return "unknown";
    }

    normalizeModelName(text) {
        if (!text) return null;
        const lower = text.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const patterns = {
            "gpt5": "gpt-5",
            "gpt54": "gpt-5.4",
            "gpt52": "gpt-5.2",
            "gpt4o": "gpt-4o",
            "gpt4omini": "gpt-4o-mini",
            "gpt4": "gpt-4",
            "gpt35": "gpt-3.5-turbo",
            "o1mini": "o1-mini",
            "o1": "o1",
            "gpt5thinking": "gpt-5-thinking",
            "gpt5tmini": "gpt-5-t-mini"
        };
        for (const [pattern, normalized] of Object.entries(patterns)) {
            if (lower.includes(pattern)) return normalized;
        }
        return lower.includes('gpt') ? lower : null;
    }

    // Polling watcher for post-send (call after detect send)
    watchForModelUpdate(callback, timeout = 10000) {
        const start = Date.now();
        const interval = setInterval(() => {
            const model = this.getChatGPTModel();
            if (model !== "unknown") {
                clearInterval(interval);
                callback(model);
                return;
            }
            if (Date.now() - start > timeout) {
                clearInterval(interval);
                callback("unknown");
            }
        }, 500);
    }

    // Usage: detect send (e.g., on button click/input), then watch
    detectModelMode() {
        const url = location.pathname;
        if (url.includes('/code')) return 'code-interpreter';
        if (url.includes('/chat')) return 'chat';
        return 'standard';
    }


    // analyzes the prompt to determine how to classify it
    // can be expanded much more
    classifyPrompt(text) {
        const lower = text.toLowerCase();
        if (lower.includes('write') || lower.includes('code') || lower.includes('script')) return 'creative-writing';
        if (lower.includes('explain') || lower.includes('what is')) return 'explanation';
        if (lower.includes('summarize') || lower.includes('tl;dr')) return 'summarization';
        if (lower.match(/\d+\s*(usd|dollar|€|euro)/i)) return 'pricing';
        return 'general';
    }

    // simple map to determine what language the prompt was written in
    // can be expanded much more
    detectLanguage(text) {
        const langMap = {
            en: /hello|please|thank/i,
            es: /hola|por favor|gracias/i,
            fr: /bonjour|s\'il vous plaît|merci/i,
            de: /hallo|bitte|danke/i,
            it: /ciao|per favore|grazie/i
        };

        for (const [lang, regex] of Object.entries(langMap)) {
            if (regex.test(text)) return lang;
        }
        return 'en';
    }

    // analyze the text to determine in what domain it is
    detectDomain(text) {
        const lower = text.toLowerCase();
        if (lower.includes('code') || lower.includes('javascript') || lower.includes('python')) return 'programming';
        if (lower.includes('marketing') || lower.includes('seo')) return 'marketing';
        if (lower.includes('finance') || lower.includes('$') || lower.includes('stock')) return 'finance';
        if (lower.includes('health') || lower.includes('doctor')) return 'health';
        return 'general';
    }

    // analyze the text to determine how to categorize it
    classifySafety(text) {
        const lower = text.toLowerCase();
        if (lower.includes('hack') || lower.includes('crack') || lower.includes('phishing')) return 'high-risk';
        if (lower.includes('nsfw') || lower.includes('adult') || lower.includes('sex')) return 'adult-content';
        if (lower.includes('weapon') || lower.includes('bomb') || lower.includes('drug')) return 'illegal';
        return 'safe';
    }

    // what number message in the current conversation
    getUserMessageIndex() {
        const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
        return userMessages.length;
    }
    // total length of conversation (user+AI)
    getConversationLength() {
        const allMessages = document.querySelectorAll('[data-message-author-role]');
        return allMessages.length;
    }
    // detect if the question is a  follow up
    // needs to be expanded upon
    detectFollowup(text) {
        return text.length < 50 || text.includes('this') || text.includes('it') || text.includes('above');
    }
    // a bunch of flags to ceck
    hasImageAttachment() {
        return !!document.querySelector('[data-testid="image-upload"] img');
    }

    hasFileAttachment() {
        return !!document.querySelector('[data-testid="file-upload"]');
    }

    isVoiceInputActive() {
        return !!document.querySelector('[data-state="recording"]');
    }

    isToolActive() {
        return !!document.querySelector('[data-mode="plugins"]');
    }
    // generate a conversationID
    getConversationId() {
        // First, check for query parameter (backward compatibility)
        const urlParams = new URLSearchParams(location.search);
        let convId = urlParams.get('conversationId');

        // If not found, extract from path: /c/<uuid> using regex
        if (!convId) {
            const pathMatch = location.pathname.match(/^\/c\/([a-f0-9\-]+)$/);
            if (pathMatch) {
                // pathMatch[0] would include the /c/ at the start
                convId = pathMatch[1];
            }
        }

        return convId || 'unknown';
    }
    // read some data on the clients environment
    getClientEnvironment() {
        const ua = navigator.userAgent;
        let browser = "unknown";
        let version = 0;
        let os = "unknown";

        // Simple browser detection
        if (ua.includes("Chrome")) {
            browser = "Chrome";
            const match = ua.match(/Chrome\/([\d]+)/);
            if (match) version = parseInt(match[1]);
        } else if (ua.includes("Firefox")) {
            browser = "Firefox";
            const match = ua.match(/Firefox\/([\d]+)/);
            if (match) version = parseInt(match[1]);
        } else if (ua.includes("Safari") && !ua.includes("Chrome")) {
            browser = "Safari";
            const match = ua.match(/Version\/([\d]+)/);
            if (match) version = parseInt(match[1]);
        }

        // OS detection
        if (ua.includes("Win")) os = "Windows";
        else if (ua.includes("Mac")) os = "Mac";
        else if (ua.includes("Linux")) os = "Linux";

        // Viewport and timezone
        //// viewport needs to be converted to a string of mobile/tablet/desktop
        const viewport = `${window.innerWidth}x${window.innerHeight}`;
        //// timezone is currently a number, needs to be converted to a region EU/US/ASIA based on the number
        const timezone = -new Date().getTimezoneOffset(); // convert to positive offset

        return {
            browser,
            version,
            os,
            viewport,
            timezone,
            plugin_version: this.extensionVersion || "unknown"
        };
    }
}

// Initialize

// if the document is still loading, add an event listener that will run
// once loading is finished
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => new ChatGPTDetector());
    // or else just create the class immediately
} else {
    new ChatGPTDetector();
}
