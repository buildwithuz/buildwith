import { type Lang, translate } from '@buildwith/i18n'

/**
 * The Telegram bot is buildwith.uz's support channel; there is no email. Its
 * username comes from the environment so pages always point at the real bot,
 * and GitHub Discussions takes over when no bot is configured.
 */
export function supportBot(): string | null {
  const name = process.env.BUILDWITH_TELEGRAM_BOT_USERNAME?.replace(/^@/, '').trim()
  return name ? name : null
}

export function supportUrl(): string {
  const bot = supportBot()
  return bot ? `https://t.me/${bot}` : 'https://github.com/buildwithuz/buildwith/discussions'
}

const DISCUSSIONS = 'https://github.com/buildwithuz/buildwith/discussions'

/** One sentence, in Markdown, telling a reader how to reach the team. */
export function contactSentence(lang: Lang): string {
  const bot = supportBot()
  return bot
    ? translate(lang, 'support.contact_bot', { link: `[@${bot}](https://t.me/${bot})` })
    : translate(lang, 'support.contact_fallback', { link: `[GitHub Discussions](${DISCUSSIONS})` })
}
