import type { Meta, StoryObj } from '@storybook/react-vite'
import { Logo, Mark } from './Logo'

const meta: Meta = { title: 'Brand/Logo' }
export default meta

export const Lockup: StoryObj = { render: () => <Logo height={40} /> }
export const MarkOnly: StoryObj = { render: () => <Mark size={48} title="buildwith.uz" /> }
