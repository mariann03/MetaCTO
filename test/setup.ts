// Make `server-only` importable from bun test (it throws outside a React Server build).
import { mock } from "bun:test";

mock.module("server-only", () => ({}));
