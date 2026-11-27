import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('defaults to type=button so it never submits a form by accident', () => {
    render(<Button>Saqlash</Button>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button')
  })
  it('calls onClick and respects disabled', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Ok</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(
      <Button onClick={onClick} disabled>
        Ok
      </Button>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('renders a link with button styles when asChild', () => {
    render(
      <Button asChild>
        <a href="/write">Yozish</a>
      </Button>,
    )
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/write')
    expect(link.className).toContain('rounded-control')
  })
})
