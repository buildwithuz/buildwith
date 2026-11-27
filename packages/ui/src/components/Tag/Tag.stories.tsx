import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from '../Badge/Badge'
import { Tag } from './Tag'

const meta: Meta = { title: 'Display/Tag and Badge' }
export default meta

export const Tags: StoryObj = {
  render: () => (
    <div className="flex gap-2">
      <Tag slug="go" />
      <Tag slug="postgresql" />
      <Tag slug="ochiq-kod" />
    </div>
  ),
}
export const Badges: StoryObj = {
  render: () => (
    <div className="flex gap-2">
      <Badge tone="turquoise">Ishga ochiq</Badge>
      <Badge tone="lapis">Moderator</Badge>
      <Badge tone="saffron">420 karma</Badge>
      <Badge>Ilk aʼzo</Badge>
    </div>
  ),
}
