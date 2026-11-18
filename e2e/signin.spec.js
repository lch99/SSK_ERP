import { test, expect } from '@playwright/test'
import { watchErrors, fitsWidth } from './helpers.js'

// The sign-in screens of the server build (VITE_USE_SERVER=true), with the server's answers stood in:
// what a client sees before the ERP, without a database. The real sign-in is in staging.spec.js.
const USER = { id: 7, username: 'aisyah', name: 'Nur Aisyah', role: 'staff', branchId: 1 }
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/status', r => json(r, 200, { needsFirstUser: false }))
})

test('sign in: a wrong password is told, the password can be shown, and the right one keeps the session', async ({ page }) => {
  const errors = watchErrors(page)
  const tries = []
  await page.route('**/api/auth/login', async r => {
    const body = r.request().postDataJSON()
    tries.push(body)
    return body.password === 'correct horse battery' ? json(r, 200, { token: 'signed-token', user: USER }) : json(r, 401, { error: 'Wrong username or password.' })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await fitsWidth(page)

  await page.getByLabel('Username').fill('aisyah')
  const password = page.getByLabel('Password', { exact: true })
  await password.fill('not it')
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Wrong username or password.')).toBeVisible()

  await password.fill('correct horse battery')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ssk-token'))).toBe('signed-token')
  expect(tries).toEqual([{ username: 'aisyah', password: 'not it' }, { username: 'aisyah', password: 'correct horse battery' }])
  expect(errors.filter(e => !/401|Failed to load resource/.test(e))).toEqual([])
})

test('forgot password: the typed username goes along, and the reply is shown', async ({ page }) => {
  let asked = null
  await page.route('**/api/auth/forgot', r => { asked = r.request().postDataJSON(); return json(r, 200, { ok: true, message: 'Your branch office has been asked to send you a link.' }) })
  await page.goto('/')
  await page.getByLabel('Username').fill('Aisyah')
  await page.getByRole('button', { name: 'Forgot password, or never set one?' }).click()
  await expect(page.getByRole('heading', { name: 'A new password link' })).toBeVisible()
  await expect(page.getByLabel('Username')).toHaveValue('Aisyah')
  await page.getByRole('button', { name: 'Ask for a new link' }).click()
  await expect(page.getByText('Your branch office has been asked to send you a link.')).toBeVisible()
  expect(asked).toEqual({ username: 'aisyah' })
  await page.getByRole('button', { name: 'Back to sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('a set-password link: whose it is, the two passwords must match, then straight in', async ({ page }) => {
  let set = null
  await page.route('**/api/auth/link/good-link', r => (r.request().method() === 'GET'
    ? json(r, 200, { username: 'aisyah', name: 'Nur Aisyah', purpose: 'invite' })
    : (set = r.request().postDataJSON(), json(r, 200, { token: 'from-link', user: USER }))))
  await page.goto('/#/password?t=good-link')
  await expect(page.getByText('aisyah', { exact: true })).toBeVisible()
  await fitsWidth(page)
  await page.getByLabel(/^Password \(at least/).fill('correct horse battery')
  await page.getByLabel('Password again', { exact: true }).fill('correct horse batterz')
  await page.getByRole('button', { name: 'Save and sign in' }).click()
  await expect(page.getByText("The two passwords don't match.")).toBeVisible()
  expect(set).toBeNull()
  await page.getByLabel('Password again', { exact: true }).fill('correct horse battery')
  await page.getByRole('button', { name: 'Save and sign in' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ssk-token'))).toBe('from-link')
  expect(set).toEqual({ password: 'correct horse battery' })
})

test('a used or expired link says so', async ({ page }) => {
  await page.route('**/api/auth/link/old-link', r => json(r, 410, { error: 'This link has been used or has expired. Ask your office for a new one.' }))
  await page.goto('/#/password?t=old-link')
  await expect(page.getByText('This link has been used or has expired. Ask your office for a new one.')).toBeVisible()
})

test('the first account asks for the setup key when the server wants one', async ({ page }) => {
  let sent = null
  await page.unroute('**/api/auth/status')
  await page.route('**/api/auth/status', r => json(r, 200, { needsFirstUser: true, needsSetupKey: true }))
  await page.route('**/api/auth/first-user', r => { sent = r.request().postDataJSON(); return json(r, 403, { error: 'That setup key is not right.' }) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome to SubSaleKing ERP' })).toBeVisible()
  await page.getByLabel('Your name').fill('Jonathan')
  await page.getByLabel('Username').fill('Jonathan')
  await page.getByLabel(/^Password \(at least/).fill('correct horse battery')
  await page.getByLabel('Password again', { exact: true }).fill('correct horse battery')
  await page.getByLabel(/^Setup key/).fill('not-the-key')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('That setup key is not right.')).toBeVisible()
  expect(sent).toEqual({ name: 'Jonathan', username: 'jonathan', password: 'correct horse battery', setupKey: 'not-the-key' })
})

// When the server, or what stands in front of it, fails, the person reads what happened and what to do:
// never "Request failed (502)", "Unexpected token <…" or "Failed to fetch".
const FAILING = [
  ['an error page from the proxy in front of the server', r => r.fulfill({ status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1><hr>nginx</body></html>' }),
    /not answering right now \(it may be restarting\)/],
  ['no server at all', r => r.abort('connectionrefused'), /Cannot reach the server\. Check your internet connection/],
  ['a web page where the API should be', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ERP</title><p>Hello' }),
    /a reply the ERP could not read/],
]
for (const [what, answer, said] of FAILING) {
  test(`${what} is said in plain words, with Try again`, async ({ page }) => {
    let failing = true
    await page.unroute('**/api/auth/status')
    await page.route('**/api/auth/status', r => (failing ? answer(r) : json(r, 200, { needsFirstUser: false })))
    await page.goto('/')
    await expect(page.getByText(said)).toBeVisible()
    await expect(page.getByText(/Request failed|Unexpected token|JSON|Failed to fetch|Bad Gateway/)).toHaveCount(0)
    failing = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })
}

test('a kept session while the server fails is said, not turned into the sign-in screen', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ssk-token', 'kept-token'))
  await page.route('**/api/auth/me', r => r.fulfill({ status: 504, contentType: 'text/html', body: '<h1>504 Gateway Time-out</h1>' }))
  await page.goto('/')
  await expect(page.getByText(/The server took too long to answer/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('ssk-token'))).toBe('kept-token')
})

test('a kept session the server no longer takes goes back to sign in, saying why', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ssk-token', 'old-token'))
  await page.route('**/api/auth/me', r => json(r, 401, { error: 'Your session has expired. Please sign in again.' }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('Your session has expired. Please sign in again.')).toBeVisible()
})
