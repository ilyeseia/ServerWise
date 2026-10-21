/**
 * A stand-in for an AI provider, used only by the end-to-end tests. It speaks the OpenAI
 * chat-completions protocol, so the application's real HTTP provider code is exercised end to end
 * without any key, network access or cost.
 *
 *   node tests/e2e/fake-ai-server.mjs        (port from E2E_AI_PORT, default 3199)
 *
 * Behaviour, chosen from what the application sends:
 *   - the word FORCE_ERROR in the message  -> HTTP 500 (the outage path)
 *   - the word FORCE_SECRET in the message -> an answer that contains a password (the redaction path)
 *   - otherwise a short answer that names the language and the task, so tests can see what was asked
 */
import { createServer } from "node:http";

const port = Number(process.env.E2E_AI_PORT ?? 3199);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404);
    res.end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const user = String(body.messages?.find((m) => m.role === "user")?.content ?? "");
    const language = /Language of your answer: (\w+)/.exec(user)?.[1] ?? "?";
    const task = /Task: ([^\n]{0,60})/.exec(user)?.[1] ?? "?";

    if (user.includes("FORCE_ERROR")) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "boom (the app must not show this)" } }));
      return;
    }

    const answer = user.includes("FORCE_SECRET")
      ? {
          text: "Le mot de passe: Tr0ub4dor&3 du serveur",
          points: ["clé sk-live-ABCDEFGHIJKLMNOP1234"],
        }
      : {
          text: `[E2E ${language}] ${task}`,
          points: ["Premier point E2E", "Second point E2E"],
          subject: "Sujet E2E",
        };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }],
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake AI provider listening on ${port}`);
});
