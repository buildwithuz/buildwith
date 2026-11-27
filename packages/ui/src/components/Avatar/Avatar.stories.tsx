import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from './Avatar'

const meta: Meta<typeof Avatar> = {
  title: 'Display/Avatar',
  component: Avatar,
  args: { name: 'Aziz Karimov' },
}
export default meta
type S = StoryObj<typeof Avatar>

export const Initials: S = {}
export const Accents: S = {
  render: () => (
    <div className="flex gap-3">
      {(['lapis', 'turquoise', 'saffron', 'plum', 'moss'] as const).map((a) => (
        <Avatar key={a} name="Malika Yusupova" accent={a} />
      ))}
    </div>
  ),
}
export const Sizes: S = {
  render: () => (
    <div className="flex items-end gap-3">
      {[24, 32, 40, 64, 96].map((s) => (
        <Avatar key={s} name="Dilnoza" size={s} accent="plum" />
      ))}
    </div>
  ),
}
