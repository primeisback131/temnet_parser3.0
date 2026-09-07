import { defineConfig } from "@playwright/test";

// Smoke through the user's entry point: the built bundle (dist/) in a real
// Chromium, the API mocked inside the page. `npm test` builds first (pretest);
// CI builds in its own step and runs `npx playwright test` directly.
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    // 4173, not 5173: the dev server or run_frontend_prod.bat may hold 5173.
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  reporter: process.env.CI ? "github" : "list",
});
