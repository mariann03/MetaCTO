import "server-only";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { registerTelemetry } from "ai";
import type { Env } from "@/env";

/**
 * Engineers inspect each AI call (prompt, output, tokens, latency, tool calls) in Langfuse.
 * Only AI SDK spans are exported (the processor's default filter), not Next.js's own.
 */
export function startTracing(env: Env) {
  const sdk = new NodeSDK({
    serviceName: "feature-intelligence",
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: env.LANGFUSE_PUBLIC_KEY,
        secretKey: env.LANGFUSE_SECRET_KEY,
        baseUrl: env.LANGFUSE_BASE_URL,
        // A serverless function is frozen after it responds, so batched spans would be lost.
        exportMode: process.env.VERCEL ? "immediate" : "batched",
      }),
    ],
  });
  sdk.start();
  // A long-running server flushes what is still batched when it stops.
  process.once("SIGTERM", () => void sdk.shutdown());
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
}
