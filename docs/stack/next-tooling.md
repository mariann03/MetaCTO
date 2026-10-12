# Next.js tooling: Next 16, Bun, Biome, bun test, date-fns, ms

Researched 2026-10-12. Sources: Context7 (`/vercel/next.js`, `/biomejs/website`, `/oven-sh/bun`, `/date-fns/tz`, `/vercel/ms`, `/colinhacks/zod`), official docs, npm registry.
**Verified empirically** means I ran it in a scratch project: `create-next-app@16.4.0` scaffold, `next build`, Biome 2.5.15, Bun 1.3.11 and 1.4.3, `tsc`. Anything I didn't run or find stated in the docs is marked **UNVERIFIED**.

## Versions (npm `latest` dist-tag, 2026-10-12)

| Package | latest | Notes |
|---|---|---|
| next / create-next-app / eslint-config-next | 16.4.0 | canary 16.5.0-canary.8 |
| react / react-dom | 19.3.0 | |
| @biomejs/biome | 2.5.15 | create-next-app pins **2.4.2**. Bump it. |
| bun | 1.4.3 | 1.4 is the Zig→Rust rewrite and has breaking changes (see §1). Local machine has 1.3.11. |
| tailwindcss | 4.3.3 | scaffold uses `@tailwindcss/turbopack` loader, not PostCSS |
| typescript | **7.0.2** | scaffold still pins `^5`. Keep ^5. Whether Next 16.4 works with TS 7 is UNVERIFIED. |
| zod | 4.6.6 | |
| date-fns | 4.4.0 | `@date-fns/tz` 1.5.0 |
| ms | **2.1.3** | v3 is only `beta` (3.0.0-beta.2) and `canary`. Its types come from `@types/ms` 2.1.0. |
| server-only | 0.0.1 | |

---

## 1. Scaffolding and running Next with Bun

### Command (verified, create-next-app 16.4.0)

```bash
bunx create-next-app@latest my-app \
  --ts --tailwind --app --src-dir --biome \
  --import-alias "@/*" --use-bun --no-agent-feedback --yes
```

- **The linter flag exists:** `--biome` | `--eslint` | `--no-linter`. With `--biome`, `package.json` gets `"lint": "biome check"` and `"format": "biome format --write"`, plus a `biome.json`. ESLint is not installed.
- **Turbopack is the default** for `next dev` and `next build`, so no flag is needed. `--turbopack` and `--webpack` are listed in the docs table but **not in `--help` for 16.4.0**, which shows `--rspack` instead. Use `next dev --webpack` to opt out.
- Other flags: `--react-compiler`, `--cache-components`, `--empty`, `--api` (route handlers only), `--skip-install`, `--disable-git`, `--agents-md` (default on, writes `AGENTS.md`).
- **Defaults to know about (verified from the generated files):**
  - `next.config.ts` ships with `cacheComponents: true` **and** `partialPrefetching: true`. Cache Components is the default for App Router. This changes route handler and segment config rules (§2).
  - Tailwind v4 is wired through `turbopack.rules['*.css'].loaders = ['@tailwindcss/turbopack']`. There is no `postcss.config.mjs`.
  - `tsconfig.json` has `paths: { "@/*": ["./src/*"] }`, `moduleResolution: "bundler"`, and includes `.next/dev/types/**/*.ts`, because dev output now goes to `.next/dev`.
  - `package.json` gets `packageManager: "bun@<local version>"` and `trustedDependencies: ["sharp","unrs-resolver"]`.
  - Node engine for next 16.4.0: `>=20.9.0`.

### Bun as package manager vs `--bun` runtime

- `bun run dev` with the scaffolded `"dev": "next dev"` runs the Next CLI on **Node**, because the `next` bin has a node shebang. Bun only acts as the package manager and script runner.
- `bun --bun next dev` forces the **Bun runtime**. Bun's guide documents it: prefix dev, build and start with `bun --bun`. Vercel says Next.js + ISR on the Bun runtime needs `"dev": "bun run --bun next dev"`, `"build": "bun run --bun next build"`, plus `"bunVersion": "1.4.x"` (or `"1.x"` = 1.3.14) in `vercel.json`.
- Bun 1.4 gotcha: when Bun is invoked as node (`bun --bun`, `bunx --bun`), it **no longer loads `.env` files**. Next loads `.env*` itself via `@next/env`, so this probably doesn't matter for `next dev` (UNVERIFIED). It does matter for ad-hoc scripts.
- **Recommendation:** use Bun as **package manager + test runner** and keep the Next server on Node, which is the default and is what Vercel runs unless you set `bunVersion`. Dev and prod then behave the same, and you avoid an extra runtime variable. Switch to `--bun` only if there is a measured reason.

Sources: https://nextjs.org/docs/app/api-reference/cli/create-next-app · https://bun.com/docs/guides/ecosystem/nextjs · https://vercel.com/docs/functions/runtimes/bun · https://bun.com/blog/bun-v1.4

---

## 2. App Router patterns

### Server Action + Zod 4 + `useActionState`

```ts
// src/app/actions.ts
"use server";
import * as z from "zod";

const Schema = z.object({ email: z.email({ error: "Invalid email" }).trim() });

export type State = { errors?: Record<string, string[] | undefined>; message?: string } | undefined;

export async function createThing(_prev: State, formData: FormData): Promise<State> {
  const parsed = Schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  // ...mutate, then revalidatePath / redirect
  return { message: "ok" };
}
```

```tsx
// client form
"use client";
import { useActionState } from "react";
import { createThing } from "@/app/actions";
export function Form() {
  const [state, action, pending] = useActionState(createThing, undefined);
  return (
    <form action={action}>
      <input name="email" />
      {state?.errors?.email && <p>{state.errors.email[0]}</p>}
      <button disabled={pending} type="submit">Save</button>
    </form>
  );
}
```

- With `useActionState`, the action's first parameter becomes `prevState`.
- Next's own auth guide still uses `validatedFields.error.flatten().fieldErrors`. The Zod 4 API is `z.flattenError(err)` (`{ formErrors, fieldErrors }`) or `z.treeifyError(err)` for nested schemas. Zod 4 deprecates `z.formatError`. Whether the instance method `.flatten()` is formally deprecated is UNVERIFIED, so prefer `z.flattenError`.
- Treat actions as public endpoints: validate and authorize inside every action.

### `after()` from `next/server`

- **Stable since v15.1.0.** It was `unstable_after` in the 15.0 RC.
- Schedules a callback to run after the response, or after the prerender, finishes. It runs even if the route throws, `notFound()`s or `redirect()`s.
- It runs for the route's default or configured `maxDuration`. On Vercel, `after` maps to `waitUntil`, which keeps the function alive until the promise settles. `maxDuration` is written into a build manifest that the platform enforces, not Next.
- Request APIs: in **Route Handlers and Server Actions** you can call `cookies()`/`headers()` *inside* the `after` callback. In **Server Components** that throws, so read the values first and close over them.
- Self-host (`next start`): supported. Pending `after` callbacks are drained on SIGTERM/SIGINT. Static export: not supported.
- Caveat: `after` is not a job queue. Work is lost if the instance dies, and it's capped by `maxDuration`. For long or retryable work, persist a job row and poll it.

```ts
import { after } from "next/server";
export async function POST(req: Request) {
  const job = await createJob(await req.json());
  after(async () => { await runJob(job.id); }); // bounded by maxDuration
  return Response.json({ id: job.id }, { status: 202 });
}
```

### Route Handlers for polling / streaming (Cache Components ON)

Verified with `next build` on 16.4.0 + `cacheComponents: true`:

| GET handler body | Build result |
|---|---|
| `return Response.json({ ok: true })` (constant) | `○` static, **prerendered at build** |
| uses `Date.now()` | `ƒ` dynamic |
| reads `request.nextUrl.searchParams` | `ƒ` dynamic |
| `await connection()` first | `ƒ` dynamic |
| `export const dynamic = "force-dynamic"` | **build error**: `Route segment config "dynamic" is not compatible with nextConfig.cacheComponents` |

- With Cache Components, `dynamic`, `dynamicParams`, `fetchCache` and `revalidate` exports are rejected. A status endpoint should read the request, or call `await connection()` from `next/server` to say so explicitly.
- Streaming works with a `ReadableStream`, e.g. for SSE:

```ts
import { connection } from "next/server";
export async function GET(req: Request) {
  await connection();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ status: "running" })}\n\n`));
      c.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
```

Plain `fetch` polling of a JSON route is simpler and enough unless sub-second updates matter.

### Cron via `vercel.json` (optional)

```json
{ "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/sweep", "schedule": "0 5 * * *" }] }
```

- `path` must start with `/`. `schedule` is a cron expression in UTC.
- Secure it by setting a `CRON_SECRET` env var. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`, and the handler checks `if (!secret || auth !== \`Bearer ${secret}\`) return 401`.
- Plan limits (Hobby frequency) and production-only invocation: UNVERIFIED, check https://vercel.com/docs/cron-jobs/usage-and-pricing.

### `server-only`

`import "server-only";` at the top of modules holding secrets or DB access causes a build error if a Client Component imports the module. Its package `exports` maps the `react-server` condition to `empty.js` and the default to a file that **throws**. That matters for tests (§4).

### Env vars

- Only `NEXT_PUBLIC_*` vars (and `next.config` `env`) are **inlined at build time**. Server vars stay runtime `process.env` lookups.
- Load order: `.env.$(NODE_ENV).local` > `.env.local` > `.env.$(NODE_ENV)` > `.env`. Shell env always wins.
- For tests or scripts that need Next's loading, use `import { loadEnvConfig } from "@next/env"; loadEnvConfig(process.cwd())`.
- Keep validation simple: parse `process.env` once with a Zod schema in a `server-only` module (`src/server/env.ts`).

### `instrumentation.ts`

- Put it at `src/instrumentation.ts` when using `src/`, outside `app/`. `register()` is called once per server instance, before the server handles requests.
- Guard runtime-specific imports with `process.env.NEXT_RUNTIME === "nodejs" | "edge"`.
- `export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {...}` (`import type { Instrumentation } from "next"`) for error reporting.

Sources: https://nextjs.org/docs/app/guides/forms · https://nextjs.org/docs/app/api-reference/functions/after · https://nextjs.org/docs/app/guides/migrating-to-cache-components · https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents · https://nextjs.org/docs/app/guides/environment-variables · https://nextjs.org/docs/app/guides/instrumentation · https://vercel.com/docs/cron-jobs/quickstart · https://vercel.com/docs/cron-jobs/manage-cron-jobs · https://zod.dev/error-formatting

---

## 3. Biome 2.5 (replaces ESLint and Prettier)

### `biome.json` (verified with Biome 2.5.15 on the scaffold)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true, "includes": ["**", "!node_modules", "!.next", "!dist", "!build"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "css": { "parser": { "tailwindDirectives": true } },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "nursery": {
        "useSortedClasses": { "level": "warn", "fix": "safe", "options": { "functions": ["cn", "clsx", "cva"] } }
      }
    },
    "domains": { "next": "all", "react": "recommended" }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- This is the scaffold's config with three changes: schema 2.5.15, `useSortedClasses`, and `next: "all"`. Bump the dependency with `bun add -d -E @biomejs/biome@2.5.15`.
- **`useSortedClasses` is still in `nursery`** in 2.5.15, checked in the schema. It is off unless opted in and its fix is unsafe by default. `"fix": "safe"` lets `biome check --write` apply it, which I verified: `"p-4 flex text-red-500 bg-white"` became `"flex bg-white p-4 text-red-500"`. It flags the scaffold's own `page.tsx`/`layout.tsx`, so run `--write` once after init.
- **`css.parser.tailwindDirectives: true`** lets Biome parse `@import "tailwindcss"`, `@theme inline` and similar. Verified clean on the scaffold `globals.css`.
- **Domains:** the values are `"recommended" | "all" | "none"` (the docs say `none`, not `off`). Biome auto-enables the `next` domain when `next >= 14` is in `package.json`, and the `react` domain when `react` is a dependency. Available domains in 2.5: `astro, drizzle, next, playwright, project, qwik, react, reactNative, solid, test, ...`.
- `next: "recommended"` **skips `noNextAsyncClientComponent`**. I verified it doesn't fire under recommended and does fire as an error under `"all"`. It also skips `noSyncScripts` and `noBeforeInteractiveScriptOutsideDocument`, which is why the config uses `"all"`.

### Scripts

```json
"lint": "biome check",
"lint:fix": "biome check --write",
"format": "biome format --write",
"ci": "biome ci"
```

- `biome check` runs the formatter, the linter and assist actions such as organize imports. `--write` applies safe fixes, and `--unsafe` adds unsafe ones.
- `biome ci` is the read-only variant for CI.
- `biome migrate eslint --write` exists for porting an ESLint config. It isn't needed for a fresh project.
- Next 16 removed `next lint`, and the scaffold doesn't use it. That removal is from the 16 upgrade guide and is UNVERIFIED for the exact version.

### VS Code

- Install the `biomejs.biome` extension and set `"editor.defaultFormatter": "biomejs.biome"`.
- Add `"editor.codeActionsOnSave": { "source.fixAll.biome": "explicit", "source.organizeImports.biome": "explicit" }`. Only safe fixes are applied on save.
- `biome.requireConfiguration` exists as a setting.

### Lint coverage lost vs `eslint-config-next` 16.4.0

`eslint-config-next` bundles `@next/eslint-plugin-next`, `eslint-plugin-react`, `react-hooks` **v7** (React Compiler rules), `jsx-a11y`, `import` and `typescript-eslint`.

- **Next plugin rules with a Biome equivalent:** google-font-display, google-font-preconnect, inline-script-id, no-async-client-component, no-before-interactive-script-outside-document, no-document-import-in-page, no-head-element, no-head-import-in-document, no-img-element, no-sync-scripts, no-unwanted-polyfillio.
- **No Biome equivalent** (checked in the 2.5.15 schema): `no-html-link-for-pages`, `no-location-assign-relative-destination`, `next-script-for-ga`, `no-assign-module-variable`, `no-css-tags`, `no-duplicate-head`, `no-page-custom-font`, `no-script-component-in-head`, `no-styled-jsx-in-document`, `no-title-in-document-head`, `no-typos`. Most of these are Pages Router or `_document` rules, so they are irrelevant to an App Router-only app.
- **The real loss is `eslint-plugin-react-hooks` v7's React Compiler rules** (purity, refs, set-state-in-render/effect, and so on). Biome only has `useExhaustiveDependencies` and `useHookAtTopLevel`. Exact rule-by-rule parity with `typescript-eslint` type-aware rules and `jsx-a11y` is UNVERIFIED. Biome's a11y group covers much of jsx-a11y.

Sources: https://biomejs.dev/linter/domains/ · https://biomejs.dev/linter/rules/use-sorted-classes/ · https://biomejs.dev/reference/configuration/ · https://biomejs.dev/reference/vscode/ · https://biomejs.dev/guides/migrate-eslint-prettier/ · https://biomejs.dev/schemas/2.5.15/schema.json

---

## 4. `bun test`

### Conventions and config

- Test files: `*.test.{ts,tsx,js,...}`, `*_test.*`, `*.spec.*`, `*_spec.*`. Import from `bun:test` (`test`, `expect`, `mock`, `spyOn`, `beforeEach`, ...). Add `@types/bun` for types.
- **tsconfig `paths` resolve natively.** I verified `@/*` → `./src/*` in tests on both Bun versions. No plugin is needed.

```toml
# bunfig.toml
[test]
root = "src"
preload = ["./test/setup.ts"]
# coverage = true
# coverageThreshold = { lines = 0.8 }
```

```ts
// test/setup.ts — make server-only importable in tests
import { mock } from "bun:test";
mock.module("server-only", () => ({}));
```

### Pitfalls with Next-specific imports (all verified on Bun 1.3.11 and 1.4.3)

1. **`import "server-only"` throws under `bun test`**: *"This module cannot be imported from a Client Component module"*. There are two working fixes:
   - Preload `mock.module("server-only", () => ({}))`, as above. This is the recommended one.
   - `bun test --conditions react-server`, which resolves the package's `empty.js`. A `[test] conditions = [...]` key in bunfig did **not** work on 1.3.11. Prefer the preload, because `react-server` also changes how React and Next resolve.
2. **`next/headers` called outside a request throws**: *"`cookies` was called outside a request scope"*. You can `mock.module("next/headers", () => ({ cookies: async () => ({ get: ... }) }))` and then `await import(...)` the module under test.
3. **`mock.module` leaks across test files.** `bun test` runs all files in one process by default, so a mock in file A broke a "real" test in file B. Fixes:
   - Bun **1.4+** has `bun test --isolate`, which gives each file a fresh global and module registry. `--parallel` implies `--isolate`. Both fixed the leak. A bunfig `isolate = true` key did **not** work.
   - Bun 1.3.x has no `--isolate`, so keep module mocks in the preload only, or avoid them.
4. **Keep domain logic testable by design.** Put pure logic in `src/lib/**` with no `next/*` imports. Server-only adapters in `src/server/**` do the I/O: they read cookies and headers, then pass plain values into the pure functions. Test the pure functions directly. Mock only at the edge, and preferably not at all.
5. `bun test` sets `NODE_ENV=test`. That `.env.test` is auto-loaded is UNVERIFIED. `--env-file .env.test` is the documented explicit way.
6. Bun 1.4: `toEqual` now compares `Temporal` objects by value, and `bunfig.toml` parsing is strict TOML.

Sources: https://bun.com/docs/test/configuration · https://bun.com/docs/test/discovery · https://bun.com/docs/test/runtime-behavior · https://bun.com/docs/runtime/module-resolution · https://bun.com/blog/bun-v1.4

---

## 5. date-fns v4 and ms

### date-fns 4.4.0 + @date-fns/tz 1.5.0 (verified: tsc clean, output checked)

```ts
import { addDays, format, startOfDay } from "date-fns";
import { TZDate, tz } from "@date-fns/tz";

// `in` option: run the calculation in a zone; returns TZDate
format(startOfDay(new Date("2026-10-12T02:00:00Z"), { in: tz("America/New_York") }), "yyyy-MM-dd HH:mm xxx");
// "2026-10-11 00:00 -04:00"

format(addDays(new TZDate(2026, 9, 12, "Europe/Madrid"), 1), "yyyy-MM-dd HH:mm xxx");
// "2026-10-13 00:00 +02:00"
```

- Use named imports from `"date-fns"`. The library is ESM and tree-shakes.
- First-class time zone support is the separate `@date-fns/tz` package (`TZDate`, `TZDateMini`, `tz()`). The old `date-fns-tz` is the v3-era third-party package, so don't use it.
- Gotcha: on the server (UTC on Vercel) and in the browser, `format(new Date())` uses the *process* zone. Pass `{ in: tz(userTz) }` or a `TZDate` explicitly to get the same output in both places. `TZDateMini` formats `toString()` in the system zone, so prefer `TZDate` for display.

### ms

- **npm `latest` is 2.1.3, a CJS package with no bundled types.** v3, which has named exports `ms`/`parse`/`format`/`parseStrict` and bundled types, is only published under the `beta`/`canary` tags. Context7 and the GitHub README describe **v3**, so don't copy those snippets onto 2.1.3.
- With 2.1.3, install `@types/ms@2.1.0`, which backports `StringValue` from v3 as a namespace type (`export = ms`). Both of these forms type-check (verified with tsc 5, `moduleResolution: bundler`):

```ts
import ms, { type StringValue } from "ms";
const ttl: StringValue = "15m";
ms(ttl);                       // 900000
ms(60_000, { long: true });    // "1 minute"
// or: ms("15m" satisfies ms.StringValue)
```

- `ms("nope")` with an invalid literal is a type error, but `ms(someString)` needs a cast. That validation only happens at runtime, and an invalid string returns `undefined`/NaN.
- For a few fixed durations, a `const MIN = 60_000` constant is enough. Add `ms` only if durations come from config strings.

Sources: https://github.com/date-fns/tz · https://date-fns.org/ · https://github.com/vercel/ms · https://www.npmjs.com/package/@types/ms
