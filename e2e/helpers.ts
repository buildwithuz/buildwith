import { expect, type Page } from '@playwright/test'

/** Sign in with Dev login (development builds only), as one of the seeded users. */
export async function signIn(page: Page, username: string) {
  await page.goto('/login')
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="username"]').press('Enter')
  await expect(page.getByRole('button', { name: /profil|profile|профиль/i })).toBeVisible()
}

/** Fail the test on any console error or uncaught exception, hydration mismatches included. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  return errors
}

export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`
