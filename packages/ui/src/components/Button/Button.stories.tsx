import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus } from 'lucide-react'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title: 'Controls/Button',
  component: Button,
  args: { children: 'Joylash' },
}
export default meta
type S = StoryObj<typeof Button>

export const Primary: S = {}
export const Secondary: S = { args: { variant: 'secondary' } }
export const Ghost: S = { args: { variant: 'ghost' } }
export const Danger: S = { args: { variant: 'danger', children: 'Hisobni oʻchirish' } }
export const WithIcon: S = { args: { children: [<Plus key="i" size={16} />, 'Yangi'] } }
export const LongRussian: S = { args: { children: 'Опубликовать сейчас и уведомить подписчиков' } }
export const Disabled: S = { args: { disabled: true } }
export const AsLink: S = { args: { asChild: true, children: <a href="/write">Maqola yozish</a> } }
