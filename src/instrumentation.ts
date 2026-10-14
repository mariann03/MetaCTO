import { readEnv, tracingEnabled } from "@/env";

/**
 * Next.js runs this once per server start. With Langfuse configured, every AI SDK call is
 * traced; without it nothing is registered, so tracing costs nothing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const env = readEnv();
  if (!tracingEnabled(env)) return;
  // Loaded only when on, so the OpenTelemetry SDK stays out of an untraced server.
  const { startTracing } = await import("@/server/tracing");
  startTracing(env);
}
