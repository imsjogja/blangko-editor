import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { generateObject, streamText } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import {
  AiUnavailable,
  createKimiGateway,
  listModels,
  mapAiError,
} from "./ai/ai-client";

const envKeys = ["KIMI_AGENTGW_BASE_URL", "KIMI_AGENTGW_API_KEY", "APP_ID"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let server: Server | undefined;

afterEach(async () => {
  if (server) {
    server.close();
    await once(server, "close");
    server = undefined;
  }
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("AI gateway contract", () => {
  it("maps quota exhaustion to a terminal AiUnavailable error", () => {
    const error = mapAiError(403, { error: { type: "access_terminated_error" } }, "");
    expect(error).toBeInstanceOf(AiUnavailable);
  });

  it("supports discovery, structured output, streaming, and APP_ID attribution", async () => {
    const attribution: Array<string | undefined> = [];
    server = createServer((request, response) => {
      attribution.push(request.headers["x-kimi-app-id"] as string | undefined);
      if (request.url === "/coding/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "model-from-discovery" }], default_model_id: "model-from-discovery" }));
        return;
      }
      if (request.url === "/coding/v1/chat/completions") {
        let raw = "";
        request.on("data", (chunk) => { raw += chunk; });
        request.on("end", () => {
          const body = JSON.parse(raw) as { stream?: boolean };
          if (body.stream) {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write(`data: ${JSON.stringify({ id: "chat-stream", object: "chat.completion.chunk", created: 1, model: "model-from-discovery", choices: [{ index: 0, delta: { role: "assistant", content: "Halo" }, finish_reason: null }] })}\n\n`);
            response.write(`data: ${JSON.stringify({ id: "chat-stream", object: "chat.completion.chunk", created: 1, model: "model-from-discovery", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
            response.end("data: [DONE]\n\n");
            return;
          }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({
            id: "chat-object",
            object: "chat.completion",
            created: 1,
            model: "model-from-discovery",
            choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ valid: true }) }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }));
        });
        return;
      }
      response.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server address unavailable");

    process.env.KIMI_AGENTGW_BASE_URL = `http://127.0.0.1:${address.port}/coding/v1`;
    process.env.KIMI_AGENTGW_API_KEY = "test-server-only-key";
    process.env.APP_ID = "app-attribution-test";

    const { defaultModelId } = await listModels();
    expect(defaultModelId).toBe("model-from-discovery");
    const gateway = createKimiGateway();

    const object = await generateObject({
      model: gateway(defaultModelId),
      schema: z.object({ valid: z.boolean() }),
      prompt: "Return the test object.",
    });
    expect(object.object).toEqual({ valid: true });

    const stream = streamText({
      model: gateway(defaultModelId),
      messages: [{ role: "user", content: "Stream one word." }],
    });
    let text = "";
    for await (const delta of stream.textStream) text += delta;
    expect(text).toBe("Halo");
    expect(attribution).toHaveLength(3);
    expect(attribution.every((value) => value === "app-attribution-test")).toBe(true);
  }, 20_000);
});
