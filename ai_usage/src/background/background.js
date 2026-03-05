// =========================
//  USER ID (stable)
// =========================
async function getOrCreateUserId() {
    return new Promise(resolve => {
        chrome.storage.local.get(["user_id"], async data => {
            if (data.user_id) {
                resolve(data.user_id);
                return;
            }

            const seed = crypto.getRandomValues(new Uint8Array(32));
            const installTime = Date.now().toString();
            const combined = new Uint8Array([...seed, ...new TextEncoder().encode(installTime)]);

            const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const userId = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

            chrome.storage.local.set({ user_id: userId }, () => resolve(userId));
        });
    });
}

// =========================
//  SESSION ID + METRICS
// =========================
function generateRandomId() {
    const arr = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getOrCreateSessionId() {
    return new Promise(resolve => {
        chrome.storage.local.get(
            ["session_id", "session_last_active", "session_start", "session_prompt_count"],
            data => {

                const now = Date.now();
                const lastActive = data.session_last_active || 0;
                const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 min

                let sessionId = data.session_id;

                // NEW SESSION?
                if (!sessionId || (now - lastActive) > SESSION_TIMEOUT) {
                    sessionId = generateRandomId();

                    chrome.storage.local.set({
                        session_id: sessionId,
                        session_last_active: now,
                        session_start: now,
                        session_prompt_count: 0
                    });
                } else {
                    chrome.storage.local.set({ session_last_active: now });
                }

                resolve(sessionId);
            }
        );
    });
}

async function getOrCreateSessionStart() {
    return new Promise(resolve => {
        chrome.storage.local.get(["session_start"], data => {
            const now = Date.now();
            if (!data.session_start) {
                chrome.storage.local.set({ session_start: now });
                resolve(now);
            } else {
                resolve(data.session_start);
            }
        });
    });
}

async function incrementSessionPromptCount() {
    return new Promise(resolve => {
        chrome.storage.local.get(["session_prompt_count"], data => {
            const count = (data.session_prompt_count || 0) + 1;
            chrome.storage.local.set({ session_prompt_count: count });
            resolve(count);
        });
    });
}

async function updateLastPromptTime() {
    const now = Date.now();
    chrome.storage.local.set({ last_prompt_time: now });
    return now;
}

async function getTimeSinceLastPrompt() {
    return new Promise(resolve => {
        chrome.storage.local.get(["last_prompt_time"], data => {
            const now = Date.now();
            const last = data.last_prompt_time || now;
            resolve(now - last);
        });
    });
}

// =========================
//  IDENTIFIER REQUEST HANDLER
// =========================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_IDENTIFIERS") {
        Promise.all([
            getOrCreateUserId(),
            getOrCreateSessionId(),
            getOrCreateSessionStart(),
            incrementSessionPromptCount(),
            getTimeSinceLastPrompt()
        ]).then(([user_id, session_id, session_start, session_prompt_count, time_since_last_prompt]) => {

            updateLastPromptTime();

            sendResponse({
                user_id,
                session_id,
                session_start,
                session_prompt_count,
                time_since_last_prompt,
                extension_version: chrome.runtime.getManifest().version
            });
        });

        return true; // keep async channel open
    }
});

// =========================
//  PROMPT EVENT INGESTION
// =========================
const SECRET_KEY = "super_secret_key_here";

async function computeHMAC(payloadString, keyString) {
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(keyString);
    const payloadBytes = encoder.encode(payloadString);

    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, payloadBytes);

    return [...new Uint8Array(signature)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PROMPT_EVENT") {
        const payload = msg.payload;
        const payloadString = JSON.stringify(payload);

        console.log("[AI Usage Meter] Prompt event received:", payload);

        computeHMAC(payloadString, SECRET_KEY).then(signature => {
            fetch("http://localhost:8000/events", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Signature": signature
                },
                body: payloadString
            })
                .then(res => res.text())
                .then(data => console.log("[AI Usage Meter] Server response:", data))
                .catch(err => console.error("[AI Usage Meter] Failed to send:", err));
        });

        sendResponse({ status: "ok" });
    }
});


console.log("[AI Usage Meter] Background service worker loaded");