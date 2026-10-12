# AI SDK stack notes (verified 2026-10-12)

Sources checked: Context7 (`/vercel/ai`, `/langfuse/langfuse-docs`, `/websites/langfuse_self-hosting`, `/vercel/next.js`), the published npm tarballs (`dist/index.d.ts` read directly), and the official docs pages linked below. Anything marked **UNVERIFIED** was not confirmed against a primary source.

## Versions (npm `latest` on 2026-10-12)

| package | version | note |
|---|---|---|
| `ai` | **7.0.137** | major is **v7** (v6 = `ai-v6` tag) |
| `@ai-sdk/anthropic` | 4.0.78 | |
| `@ai-sdk/openai` | 4.0.91 | |
| `@ai-sdk/gateway` | 4.0.110 | already a dependency of `ai` |
| `@ai-sdk/otel` | 1.0.137 | plain OTel integration for v7 |
| `voyage-ai-provider` | 5.0.0 | community; built on `@ai-sdk/provider` v4 (fits ai v7) |
| `@langfuse/otel`, `@langfuse/tracing`, `@langfuse/vercel-ai-sdk`, `@langfuse/client` | 5.13.1 | `@langfuse/vercel-ai-sdk` peer: `ai >=7 <8`, Node >= 22 |
| `@opentelemetry/sdk-node` | 0.223.0 | |
| `@opentelemetry/api` | 1.9.1 | |
| `@vercel/otel` | 2.1.3 | v2+ needed for OTel JS SDK v2 (which Langfuse uses) |
| `zod` | 4.6.6 | `ai` peer: `^3.25.76 \|\| ^4.1.8` |
| `next` | 16.4.0 | |
| Langfuse server image | **4.56.0** (`langfuse/langfuse:4`) | self-host is **v4**, not v3 |

```bash
bun add ai @ai-sdk/anthropic @ai-sdk/openai voyage-ai-provider zod
# telemetry (optional, see section 3)
bun add @langfuse/vercel-ai-sdk @langfuse/otel @langfuse/tracing @opentelemetry/sdk-node @opentelemetry/api
```

---

## 1. Vercel AI SDK (`ai` v7)

### Verified exports (from `ai@7.0.137` `index.d.ts`)
`ToolLoopAgent` (class, also aliased `Experimental_Agent`), `Output` (`Output.object`, `.array`, `.choice`, `.json`, `.text`), `generateText`, `streamText`, `tool`, `dynamicTool`, `embed`, `embedMany`, `cosineSimilarity`, `isStepCount`, `stepCountIs` (alias of `isStepCount`), `hasToolCall`, `isLoopFinished`, `createProviderRegistry`, `customProvider`, `gateway`, `createGateway`, `registerTelemetry`, `generateObject` (**deprecated**).

### Stop condition: `isStepCount(n)` is the v7 name
- v7 docs and JSDoc use `isStepCount(n)`. `stepCountIs` still works: it is exported as `isStepCount as stepCountIs`. Prefer `isStepCount`.
- `ToolLoopAgent` defaults to `stopWhen: isStepCount(20)`. `generateText` defaults to `isStepCount(1)`, so set it explicitly when you pass tools.
- `stopWhen` also takes an array, and the loop stops when any condition is true.

### `ToolLoopAgent`
Settings (from `ToolLoopAgentSettings`): `model` (required), `instructions`, `tools`, `stopWhen`, `output`, `toolChoice`, `activeTools`, `prepareStep`, `telemetry`, `providerOptions`, `maxRetries`, `temperature`, `maxOutputTokens`, `runtimeContext`, `toolApproval`, callbacks (`onStepEnd`, `onEnd`, ...). `system` is replaced by `instructions`.

```ts
import { ToolLoopAgent, Output, tool, isStepCount } from 'ai';
import { z } from 'zod';

export const researchAgent = new ToolLoopAgent({
  model: process.env.AGENT_MODEL ?? 'anthropic/claude-sonnet-5.5', // gateway string or provider instance
  instructions: 'You are a careful research assistant.',
  tools: {
    search: tool({
      description: 'Search the knowledge base',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ hits: [] as string[] }),
    }),
  },
  stopWhen: isStepCount(8),
  maxRetries: 2,
  output: Output.object({
    schema: z.object({ answer: z.string(), sources: z.array(z.string()) }),
  }),
});

const { output, text, steps } = await researchAgent.generate({ prompt: 'Summarise X' });
// output is typed and validated against the schema; agent.stream({...}) streams
```

Gotcha: producing the structured output takes one step of its own, so leave room in `stopWhen` beyond the tool calls.

### Single structured call: `generateText` + `Output.object`
`generateObject` / `streamObject` are `@deprecated Use generateText with an output setting instead`.

```ts
import { generateText, Output } from 'ai';
import { z } from 'zod';

const { output } = await generateText({
  model,
  output: Output.object({ schema: z.object({ label: z.enum(['a', 'b']), reason: z.string() }) }),
  prompt: '...',
  maxRetries: 2,
});
```

### `tool()`
Uses `inputSchema` (Zod or `jsonSchema(...)`) plus `execute`. Leaving out `execute` stops the loop so the client or a human can handle the call.

### Embeddings
```ts
import { embed, embedMany, cosineSimilarity } from 'ai';

const { embedding } = await embed({ model: embModel, value: 'query text', maxRetries: 2 });
const { embeddings } = await embedMany({ model: embModel, values: chunks, maxParallelCalls: 4 });
const score = cosineSimilarity(embedding, embeddings[0]); // throws if lengths differ
```
- In v7, `embed`/`embedMany` take a top-level `dimensions?: number`. `@ai-sdk/openai` honours it. **`voyage-ai-provider` ignores it.** For Voyage, use `providerOptions.voyage.outputDimension`.

### Retries
`maxRetries` (default 2, `0` disables) is accepted by `generateText`, `streamText`, `embed`, `embedMany` and `ToolLoopAgent` settings.

### Provider-agnostic model config from env
In v7, `model` accepts **either a string or a model instance**. A plain string goes to the global default provider, which is the **Vercel AI Gateway** (it reads `AI_GATEWAY_API_KEY`, or Vercel OIDC when deployed).

Gotcha: gateway ids and direct-provider ids are spelled differently.
- Gateway: `anthropic/claude-sonnet-5.5`, `anthropic/claude-haiku-5.5` (dots).
- `@ai-sdk/anthropic`: `claude-sonnet-5-5`, `claude-haiku-5-5` (hyphens).

Option A, the simplest (gateway): `model: process.env.AGENT_MODEL` with `AGENT_MODEL=anthropic/claude-sonnet-5.5`. This needs only `ai` and a gateway key.

Option B, direct keys without the gateway: use a registry keyed by `provider:model`.
```ts
// lib/ai/models.ts
import { createProviderRegistry } from 'ai';
import { anthropic } from '@ai-sdk/anthropic'; // ANTHROPIC_API_KEY
import { openai } from '@ai-sdk/openai';       // OPENAI_API_KEY
import { voyage } from 'voyage-ai-provider';   // VOYAGE_API_KEY

const registry = createProviderRegistry({ anthropic, openai, voyage });

export const chatModel = registry.languageModel(
  (process.env.CHAT_MODEL ?? 'anthropic:claude-haiku-5-5') as `${string}:${string}`,
);
export const embeddingModel = registry.embeddingModel(
  (process.env.EMBEDDING_MODEL ?? 'voyage:voyage-4') as `${string}:${string}`,
);
```
The default separator is `:`. `registry.embeddingModel` is documented. Registry string typing may need the cast shown above (**UNVERIFIED** whether the cast is required in 7.0.x).

Docs: https://ai-sdk.dev/docs/agents/building-agents, https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent, https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data, https://ai-sdk.dev/docs/ai-sdk-core/provider-management, https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0

---

## 2. Providers

### `@ai-sdk/anthropic` 4.x
- Typed model ids include `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-8`, and others. Both assumed names are valid and use the `claude-<family>-<major>-<minor>` pattern.
- `import { anthropic, createAnthropic } from '@ai-sdk/anthropic'`. Reads `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`.

### `@ai-sdk/openai` embeddings
- `openai.embedding('text-embedding-3-small')`. In 4.x, `textEmbedding` and `textEmbeddingModel` are deprecated; `embedding`/`embeddingModel` are current.
- `text-embedding-3-small`: **1536** dims by default. `text-embedding-3-large`: 3072. Both can be shortened with `dimensions` (source: platform.openai.com/docs/guides/embeddings).

### Voyage: `voyage-ai-provider` 5.0.0 (community, MIT)
- `import { voyage, createVoyage } from 'voyage-ai-provider'`. Reads `VOYAGE_API_KEY`.
- `voyage.embeddingModel('voyage-4')` is current. `textEmbeddingModel` is deprecated.
- Provider options under `providerOptions.voyage`: `inputType: 'query' | 'document'`, `outputDimension`, `outputDtype`, `truncation`.
- Typed ids: `voyage-4-large`, `voyage-4`, `voyage-4-lite`, `voyage-3.5`, `voyage-3.5-lite`, `voyage-3-large`, `voyage-code-3`, and others. The gateway also serves `voyage/voyage-4`, `voyage/voyage-3.5`, and so on.
- Dimensions (docs.voyageai.com/docs/embeddings): voyage-4 / 4-large / 4-lite / 3.5 / 3-large are all **1024 by default**, with 256, 512 and 2048 also available. The voyage-4 series models produce embeddings compatible with each other.

```ts
await embed({ model: voyage.embeddingModel('voyage-4'), value: q,
  providerOptions: { voyage: { inputType: 'query' } } });       // 'document' when indexing
```

### Recommendation
Default to **`voyage-4` at 1024 dims**. Anthropic's embeddings guide (docs.claude.com/en/docs/build-with-claude/embeddings) is written around Voyage. Voyage gives a smaller vector than OpenAI's 1536 and supports asymmetric query/document `inputType`. Make the DB column `vector(1024)`.

Fallback: `openai/text-embedding-3-small` with `dimensions: 1024`, which keeps the same column size. Changing the embedding model (anything outside the voyage-4 family) means re-embedding the whole corpus. Store the model id alongside the vectors.

---

## 3. Telemetry (AI SDK 7 + OTel + Langfuse)

v7 changes:
- `experimental_telemetry` was renamed to **`telemetry`**. The old name is a deprecated alias.
- Telemetry now runs through **integrations registered with `registerTelemetry(...)`**. Once an integration is registered, every call is traced by default. Opt out per call with `telemetry: { isEnabled: false }`. Name a call with `telemetry: { functionId: 'agent-x' }`.
- `runtimeContext` keys appear in traces only when you list them in `telemetry.includeRuntimeContext`.

Integrations:
- Generic OTel: `import { OpenTelemetry } from '@ai-sdk/otel'`, then `registerTelemetry(new OpenTelemetry())`. `LegacyOpenTelemetry` also exists and keeps the v6 span shape.
- Langfuse: `import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk'`. Use this one, since Langfuse publishes it for v7.

Gating on env: register nothing unless the keys are set. With no integration registered, no telemetry is emitted.

```ts
// instrumentation.ts (project root, or src/ if you use src/)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    await import('./instrumentation.node');
  }
}
```
```ts
// instrumentation.node.ts
import { registerTelemetry } from 'ai';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';

export const langfuseSpanProcessor = new LangfuseSpanProcessor(); // reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL
new NodeSDK({ spanProcessors: [langfuseSpanProcessor] }).start();
registerTelemetry(new LangfuseVercelAiSdkIntegration());
```
```env
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=http://localhost:3000   # self-hosted; cloud = https://cloud.langfuse.com
```

Gotchas:
- `NodeSDK` does not work on the Edge runtime, so guard it with `NEXT_RUNTIME === 'nodejs'` (Next.js docs).
- `@vercel/otel` also works: `registerOTel({ serviceName, spanProcessors: [new LangfuseSpanProcessor()] })`. It needs `@vercel/otel` v2 or later. Use it only if you also want Edge support. Otherwise it is one more dependency, so skip it.
- Serverless and short-lived processes: call `after(() => langfuseSpanProcessor.forceFlush())` from `next/server` in route handlers. A long-running `next start` does not need this.
- Session and user grouping: wrap calls in `propagateAttributes({ userId, sessionId, traceName, tags }, () => generateText(...))` from `@langfuse/tracing`.
- `@langfuse/vercel-ai-sdk` requires Node 22 or later. Under Bun, `bun run dev` still runs `next` on Node unless you pass `--bun`. Running the Langfuse/NodeSDK path on the Bun runtime is **UNVERIFIED**, so keep Next on Node.

Docs: https://langfuse.com/integrations/frameworks/vercel-ai-sdk, https://github.com/vercel/ai/blob/main/packages/otel/README.md, https://nextjs.org/docs/app/guides/open-telemetry

---

## 4. Langfuse self-hosting (Docker Compose): now **v4**

The current docs page is labeled "Version: v4". The images are `langfuse/langfuse:4` and `langfuse/langfuse-worker:4` (latest 4.56.0). v3 is no longer current. The service topology is the same as v3.

Official file: https://github.com/langfuse/langfuse/blob/main/docker-compose.yml (guide: https://langfuse.com/self-hosting/deployment/docker-compose)

```bash
git clone https://github.com/langfuse/langfuse.git && cd langfuse
# edit every "# CHANGEME" value, then:
docker compose up -d     # UI at http://localhost:3000 once langfuse-web logs "Ready"
```

| service | image | ports (host:container) |
|---|---|---|
| langfuse-web | `docker.langfuse.com/langfuse/langfuse:4` | `3000:3000` (UI + API) |
| langfuse-worker | `docker.langfuse.com/langfuse/langfuse-worker:4` | `127.0.0.1:3030:3030` |
| postgres | `postgres:${POSTGRES_VERSION:-17}` | `127.0.0.1:5432:5432` |
| clickhouse | `clickhouse/clickhouse-server:25.12` | `127.0.0.1:8123`, `127.0.0.1:9000` |
| redis | `redis:7` (`--requirepass`) | `127.0.0.1:6379:6379` |
| minio | `cgr.dev/chainguard/minio` | `9090:9000` (S3 API), `127.0.0.1:9091:9001` (console) |

**Port clash:** langfuse-web uses 3000, the same default as `next dev`. Run Next on another port, or remap Langfuse to something like `3001:3000` and set `NEXTAUTH_URL` and `LANGFUSE_BASE_URL` to match. Postgres on 5432 will also clash if the app runs its own Postgres.

CHANGEME secrets (all have insecure defaults in the file):
- `ENCRYPTION_KEY`: 64 hex chars, generate with `openssl rand -hex 32`
- `SALT`
- `NEXTAUTH_SECRET`
- `DATABASE_URL` and `POSTGRES_PASSWORD`
- `CLICKHOUSE_PASSWORD`
- `REDIS_AUTH`
- `MINIO_ROOT_PASSWORD`, which must match `LANGFUSE_S3_{EVENT_UPLOAD,MEDIA_UPLOAD,BATCH_EXPORT}_SECRET_ACCESS_KEY`

Also set:
- `NEXTAUTH_URL` (default `http://localhost:3000`)
- `TELEMETRY_ENABLED=false` if you don't want Langfuse's usage telemetry sent

Headless bootstrap, so you can skip the UI signup and get fixed keys for the app's `.env`:
- `LANGFUSE_INIT_ORG_ID`, `LANGFUSE_INIT_PROJECT_ID`
- `LANGFUSE_INIT_PROJECT_PUBLIC_KEY`, `LANGFUSE_INIT_PROJECT_SECRET_KEY`
- `LANGFUSE_INIT_USER_EMAIL`, `LANGFUSE_INIT_USER_PASSWORD`
- the optional `*_NAME` variants

Minimum resources from the docs: about 4 cores and 16 GiB RAM for a VM (**UNVERIFIED** for v4; this is the figure the v3 guide gave).
