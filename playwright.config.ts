import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

/**
 * Hermetic env for the app under test: a fake Supabase on :54321
 * (tests/e2e/support/mock-supabase.mjs — only accepts the token minted by
 * tests/e2e/support/fixtures.ts), blanked provider keys and mocked voice providers. Values set here win over `.env.local`
 * (Next only fills variables that are absent from process.env), so a local
 * `.env.local` with real keys is never used by the smoke tests.
 * NEXT_PUBLIC_* are inlined at build time → the build must see them too.
 */
const appEnv: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-fake-anon-key",
  NEXT_PUBLIC_SITE_URL: BASE_URL,
  // A-04: the server reads API keys from (mock) Vault with the service role — see MOCK_SERVICE_ROLE_KEY.
  SUPABASE_SERVICE_ROLE_KEY: "e2e-fake-service-role-key",
  OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  ELEVENLABS_API_KEY: "",
  FISH_API_KEY: "",
  FISH_AUDIO_API_KEY: "",
  // A-04b: voice providers are mocked too (mock-supabase.mjs → /__provider/…), never the real APIs.
  ELEVENLABS_API_BASE: "http://127.0.0.1:54321/__provider/elevenlabs",
  FISH_AUDIO_API_BASE: "http://127.0.0.1:54321/__provider/fish",
  NEXT_TELEMETRY_DISABLED: "1",
};

// E2E_SKIP_BUILD=1 reuses an existing `.next` build (must have been built with the env above).
const startCmd = `npm run start -- -p ${PORT} -H 127.0.0.1`;
const command = process.env.E2E_SKIP_BUILD === "1" ? startCmd : `npm run build && ${startCmd}`;

const mobileChromium = {
  ...devices["Pixel 7"],
  launchOptions: {
    // Local sandbox: PLAYWRIGHT_CHROMIUM_PATH=$(which chromium).
    // CI: leave unset and run `npx playwright install --with-deps chromium`.
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  },
};

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [["github"], ["html", { open: "never" }], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      testIgnore: /(perf|secrets-scan|feature-flags|fish-billing)\.spec\.ts$/,
      use: mobileChromium,
    },
    {
      // UI-12: Web Vitals budgets are timing-sensitive — run them alone, after the
      // smoke suite, so other workers don't steal CPU from the throttled page.
      name: "perf",
      testMatch: /perf\.spec\.ts$/,
      dependencies: ["chromium-mobile"],
      fullyParallel: false,
      use: mobileChromium,
    },
    {
      // A-04: plants an API key in every (mock) Vault slot → runs alone, last, so no
      // other spec ever sees "keys configured".
      name: "secrets-scan",
      testMatch: /secrets-scan\.spec\.ts$/,
      dependencies: ["perf"],
      fullyParallel: false,
      use: mobileChromium,
    },
    {name:"feature-flags",testMatch:/feature-flags\.spec\.ts$/,dependencies:["secrets-scan"],fullyParallel:false,use:mobileChromium},
    {name:"fish-billing",testMatch:/fish-billing\.spec\.ts$/,dependencies:["feature-flags"],fullyParallel:false,use:mobileChromium},
  ],
  webServer: [
    {
      command: "node tests/e2e/support/mock-supabase.mjs",
      url: "http://127.0.0.1:54321/health",
      timeout: 30_000,
      reuseExistingServer: !isCI,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command,
      url: BASE_URL,
      env: appEnv,
      timeout: 300_000,
      reuseExistingServer: !isCI,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
