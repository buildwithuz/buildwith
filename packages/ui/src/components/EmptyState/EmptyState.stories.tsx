import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../Button/Button'
import { EmptyState } from './EmptyState'

const meta: Meta<typeof EmptyState> = { title: 'Display/EmptyState', component: EmptyState }
export default meta
type S = StoryObj<typeof EmptyState>

export const Default: S = {
  args: {
    title: 'Hozircha hech narsa yoʻq.',
    children: 'Odamlar va teglarga obuna boʻling — ularning postlari shu yerda chiqadi.',
    action: <Button variant="secondary">Kimga obuna boʻlish</Button>,
  },
}
export const Cyrillic: S = { args: { title: 'Ҳозирча ҳеч нарса йўқ.' } }
