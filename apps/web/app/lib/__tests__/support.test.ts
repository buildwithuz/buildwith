import { afterEach, describe, expect, it } from 'vitest'
import { contactSentence, supportUrl } from '../support.server'

const KEY = 'BUILDWITH_TELEGRAM_BOT_USERNAME'
afterEach(() => {
  delete process.env[KEY]
})

describe('support contact', () => {
  it('points at the Telegram bot when one is configured', () => {
    process.env[KEY] = '@buildwith_bot'
    expect(supportUrl()).toBe('https://t.me/buildwith_bot')
    expect(contactSentence('en')).toBe(
      'Write to our Telegram bot [@buildwith_bot](https://t.me/buildwith_bot) — the team answers in the same chat.',
    )
    expect(contactSentence('uz')).toContain(
      'Telegramdagi [@buildwith_bot](https://t.me/buildwith_bot) botiga',
    )
  })

  it('falls back to GitHub Discussions, never an email', () => {
    expect(supportUrl()).toBe('https://github.com/buildwithuz/buildwith/discussions')
    for (const lang of ['uz', 'ru', 'en'] as const) {
      expect(contactSentence(lang)).toContain('(https://github.com/buildwithuz/buildwith/discussions)')
      expect(contactSentence(lang)).not.toContain('@buildwith.uz')
    }
  })
})
