import { expect, test } from '@playwright/test'
import { signIn, unique, watchConsole } from './helpers'

test.use({ locale: 'uz-UZ' })

test('@smoke the front page renders and hydrates cleanly for visitors', async ({ page }) => {
  const errors = watchConsole(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('article').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(errors).toEqual([])
})

test('@smoke a signed-in member posts a note and sees it on the timeline', async ({ page }) => {
  const errors = watchConsole(page)
  await signIn(page, 'aziz')
  await page.goto('/notes')
  const text = unique('e2e qayd')
  await page.getByRole('textbox').first().fill(text)
  await page.getByRole('button', { name: /^joylash$/i }).click()
  await expect(page.getByText(text)).toBeVisible()
  expect(errors).toEqual([])
})

test('asking a question and answering it', async ({ page, browser }) => {
  await signIn(page, 'nodira')
  await page.goto('/submit?kind=ask')
  const title = unique('E2E savol: qaysi editor yaxshi?')
  await page
    .getByLabel(/savol|sarlavha/i)
    .first()
    .fill(title)
  await page
    .getByRole('button', { name: /joylash|savol berish|yuborish/i })
    .last()
    .click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const questionUrl = page.url()

  // Another member answers.
  const ctx = await browser.newContext()
  const other = await ctx.newPage()
  await signIn(other, 'malika')
  await other.goto(questionUrl)
  const answer = unique('Neovim, albatta')
  await other.locator('#comment-form textarea').fill(answer)
  await other
    .locator('#comment-form')
    .getByRole('button', { name: /joylash/i })
    .click()
  await expect(other.getByText(answer)).toBeVisible()
  await ctx.close()

  await page.reload()
  await expect(page.getByText(answer)).toBeVisible()
})

test('voting works without JavaScript', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.locator('input[name="username"]').fill('jasur')
  await page.locator('input[name="username"]').press('Enter')
  await page.goto('/new')
  const row = page
    .locator('article')
    .filter({ hasNot: page.locator('[aria-pressed="true"]') })
    .first()
  const before = Number(await row.locator('form[action="/actions/vote"] span').first().textContent())
  await row.locator('form[action="/actions/vote"] button[value="1"]').click()
  await page.goto('/new')
  const after = await page.locator('form[action="/actions/vote"] span').allTextContents()
  expect(after.map(Number)).toContain(before + 1)
  await ctx.close()
})

test('Cyrillic preference transliterates content but not code or usernames', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'bw_script', value: 'cyrl', url: baseURL! }])
  await page.goto('/notes')
  const body = (await page.locator('main').textContent()) ?? ''
  expect(body).toMatch(/[а-яўқғҳ]/i)
  expect(body).toContain('@aziz')
})
