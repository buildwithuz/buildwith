import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('shows initials without an image', () => {
    const { container } = render(<Avatar name="Aziz Karimov" />)
    expect(container.textContent).toBe('AK')
  })
  it('uses two letters of a single name', () => {
    const { container } = render(<Avatar name="dilnoza" />)
    expect(container.textContent).toBe('DI')
  })
  it('renders a decorative image when src is set', () => {
    const { container } = render(<Avatar name="x" src="/media/a.jpg" />)
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('')
  })
})
