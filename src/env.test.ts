import { describe, expect, expectTypeOf, test } from "bun:test";
import { type Env, readEnv, tracingEnabled } from "./env";

const base = { DATABASE_URL: "postgres://localhost:5432/app" };

describe("env", () => {
  test("model ids default to the configured tiers", () => {
    expect(readEnv(base)).toMatchObject({
      INTAKE_MODEL: "ollama:gemma4:12b",
      REASONING_MODEL: "ollama:qwen3.6:27b",
      EMBEDDING_MODEL: "ollama:bge-m3",
      OLLAMA_BASE_URL: "http://localhost:11434",
    });
  });

  test("a provider that cannot serve the tier is rejected", () => {
    expect(() =>
      readEnv({ ...base, EMBEDDING_MODEL: "anthropic:claude-haiku-5-5" }),
    ).toThrow();
    expect(() =>
      readEnv({ ...base, INTAKE_MODEL: "voyage:voyage-4" }),
    ).toThrow();
  });

  test("model id types only admit providers that serve each tier", () => {
    expectTypeOf<Env["INTAKE_MODEL"]>().toEqualTypeOf<
      `ollama:${string}` | `anthropic:${string}` | `openai:${string}`
    >();
    expectTypeOf<Env["EMBEDDING_MODEL"]>().toEqualTypeOf<
      `ollama:${string}` | `openai:${string}` | `voyage:${string}`
    >();
    // @ts-expect-error Anthropic has no embedding models.
    const embedding: Env["EMBEDDING_MODEL"] = "anthropic:claude-haiku-5-5";
    expect(embedding).toBeDefined();
  });

  test("tracing is on only when all three Langfuse settings are given", () => {
    const langfuse = {
      LANGFUSE_PUBLIC_KEY: "pk-lf-local",
      LANGFUSE_SECRET_KEY: "sk-lf-local",
      LANGFUSE_BASE_URL: "http://localhost:3001",
    };

    expect(tracingEnabled(readEnv(base))).toBe(false);
    expect(tracingEnabled(readEnv({ ...base, ...langfuse }))).toBe(true);
    expect(() =>
      readEnv({ ...base, LANGFUSE_PUBLIC_KEY: "pk-lf-local" }),
    ).toThrow();
  });
});
