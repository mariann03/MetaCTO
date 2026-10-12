import { describe, expect, expectTypeOf, test } from "bun:test";
import { type Env, readEnv } from "./env";

const base = { DATABASE_URL: "postgres://localhost:5432/app" };

describe("env", () => {
  test("model ids default to the configured tiers", () => {
    expect(readEnv(base)).toMatchObject({
      INTAKE_MODEL: "anthropic:claude-haiku-5-5",
      REASONING_MODEL: "anthropic:claude-sonnet-5-5",
      EMBEDDING_MODEL: "voyage:voyage-4",
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
      `anthropic:${string}` | `openai:${string}`
    >();
    expectTypeOf<Env["EMBEDDING_MODEL"]>().toEqualTypeOf<
      `openai:${string}` | `voyage:${string}`
    >();
    // @ts-expect-error Anthropic has no embedding models.
    const embedding: Env["EMBEDDING_MODEL"] = "anthropic:claude-haiku-5-5";
    expect(embedding).toBeDefined();
  });
});
