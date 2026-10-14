import "server-only";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { registerTelemetry } from "ai";

/**
 * Sends a trace of every AI SDK call (prompt, output, tokens, latency, tool calls) to
 * Langfuse. The span processor reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and
 * LANGFUSE_BASE_URL from the environment.
 */
export function startTracing() {
  new NodeSDK({
    serviceName: "feature-intelligence",
    spanProcessors: [new LangfuseSpanProcessor()],
  }).start();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
}
