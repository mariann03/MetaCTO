import { defineConfig, devices } from "@playwright/test";
import ms from "ms";

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/app_e2e";
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run build && bun run start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: ms("3m"),
    env: { DATABASE_URL: E2E_DATABASE_URL, E2E_FAKE_AI: "1" },
  },
});
