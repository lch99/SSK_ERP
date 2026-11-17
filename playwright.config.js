import { defineConfig, devices } from '@playwright/test'

// End-to-end tests in a real browser (e2e/). By default against the demo (no server: the
// sample data in the browser), started here on a spare port. E2E_URL points them at a running
// ERP instead (a staging server, signed in with E2E_USER / E2E_PASSWORD; on a new server the first
// account is made with them and E2E_SETUP_KEY, its ADMIN_TOKEN).
const url = process.env.E2E_URL || 'http://localhost:5199'
// On a server, the page tests start signed in, with the session staging.spec.js saved.
const signedIn = process.env.E2E_URL ? { storageState: 'e2e/.auth/admin.json' } : {}
// The server build with no server behind it, for the sign-in screens (signin.spec.js).
const SIGNIN = 'http://localhost:5198'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Each browser builds the demo's sample records on its first page: a few at a time.
  workers: process.env.E2E_URL ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: { baseURL: url, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    // On a server, the sign-in journey first: it makes the account the rest sign in with.
    ...(process.env.E2E_URL ? [{ name: 'staging sign-in', testMatch: 'staging.spec.js', use: { ...devices['Desktop Chrome'] } }] : []),
    // On a server: the functional tests (journeys, negative and unexpected input), with a test agent of their own.
    ...(process.env.E2E_URL ? [
      { name: 'functional setup', testMatch: 'functional/setup.spec.js', dependencies: ['staging sign-in'], use: { ...devices['Desktop Chrome'], ...signedIn } },
      { name: 'functional', testMatch: 'functional/*.spec.js', testIgnore: 'functional/setup.spec.js', dependencies: ['functional setup'],
        use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, ...signedIn } },
    ] : []),
    { name: 'desktop', testIgnore: ['signin.spec.js', 'staging.spec.js', 'functional/**'], dependencies: process.env.E2E_URL ? ['staging sign-in'] : [],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, ...signedIn } },
    // A small phone: every page must fit without scrolling sideways.
    { name: 'phone', testIgnore: ['signin.spec.js', 'staging.spec.js', 'functional/**'], dependencies: process.env.E2E_URL ? ['staging sign-in'] : [],
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, ...signedIn } },
    // The sign-in screens of the server build, the server's answers stood in (no database needed).
    ...(process.env.E2E_URL ? [] : [
      { name: 'sign-in desktop', testMatch: 'signin.spec.js', use: { ...devices['Desktop Chrome'], baseURL: SIGNIN } },
      { name: 'sign-in phone', testMatch: 'signin.spec.js', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, baseURL: SIGNIN } },
    ]),
  ],
  webServer: process.env.E2E_URL ? undefined : [
    { command: 'npx vite --port 5199 --strictPort', url, reuseExistingServer: true, timeout: 60_000 },
    { command: 'npx vite --port 5198 --strictPort', url: SIGNIN, env: { VITE_USE_SERVER: 'true', API_PORT: '3999' }, reuseExistingServer: true, timeout: 60_000 },
  ],
})
