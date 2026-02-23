// import { BACKEND_URL, EXTENSION_API_KEY } from "../lib/config.js";
// import { getSessionId } from "../lib/session.js";

// chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
//     if (msg.type === "PROMPT_EVENT") {
//         handlePromptEvent(msg.payload);
//     }
// });

// async function handlePromptEvent(event) {
//     const session_id = await getSessionId();

//     const payload = {
//         session_id,
//         timestamp: event.timestamp,
//         source: event.source,
//         model: event.model,
//         tokens_in: event.tokens_in
//         // tokens_out, energy_wh can be added later
//     };

//     try {
//         // await fetch(BACKEND_URL, {
//         //   method: "POST",
//         //   headers: {
//         //     "Content-Type": "application/json",
//         //     "X-API-Key": EXTENSION_API_KEY
//         //   },
//         //   body: JSON.stringify(payload)
//         // });
//         console.log("promt event received:", payload)
//     } catch (e) {
//         // you can add retry/queue logic later
//         console.warn("Failed to send prompt event", e);
//     }
// }



console.log("[AI Usage Meter] Background service worker loaded");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PROMPT_EVENT") {
        const payload = msg.payload;

        console.log("[AI Usage Meter] Prompt event received:", payload);

        // Send to local FastAPI server
        fetch("http://localhost:8000/events", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        })
            .then(res => res.text())
            .then(data => console.log("[AI Usage Meter] Server response:", data))
            .catch(err => console.error("[AI Usage Meter] Failed to send:", err));

        sendResponse({ status: "ok" });
    }
});