import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:"./tests",testMatch:"**/*.spec.js",timeout:45000,expect:{timeout:8000},retries:1,
  use:{baseURL:"http://127.0.0.1:3000",trace:"retain-on-failure",...devices["Desktop Chrome"]},
  webServer:{command:"npm start",url:"http://127.0.0.1:3000/api/health",reuseExistingServer:!process.env.CI,timeout:60000}
});
