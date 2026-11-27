import type { Decorator, Preview } from '@storybook/react-vite'
import './preview.css'

// Toolbar switches for the three things every component must survive:
// dark mode, Cyrillic script and the longer Russian locale.
const withGlobals: Decorator = (Story, ctx) => {
  document.documentElement.dataset.theme = ctx.globals.theme
  document.documentElement.lang = ctx.globals.locale
  return (
    <div className="bg-paper p-6 text-ink" data-script={ctx.globals.script}>
      <Story />
    </div>
  )
}

const preview: Preview = {
  decorators: [withGlobals],
  globalTypes: {
    theme: { description: 'Theme', toolbar: { icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true } },
    script: { description: 'Script', toolbar: { icon: 'globe', items: ['latn', 'cyrl'], dynamicTitle: true } },
    locale: { description: 'Locale', toolbar: { icon: 'comment', items: ['uz', 'ru', 'en'], dynamicTitle: true } },
  },
  initialGlobals: { theme: 'light', script: 'latn', locale: 'uz' },
  parameters: { a11y: { test: 'error' }, layout: 'fullscreen' },
}
export default preview
