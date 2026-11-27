import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Field, Input } from './Field'

describe('Field', () => {
  it('labels the control and links the hint and error for screen readers', () => {
    render(
      <Field label="Sarlavha" hint="3-100 belgi" error="Juda qisqa">
        {(p) => <Input {...p} />}
      </Field>,
    )
    const input = screen.getByLabelText('Sarlavha')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = input.getAttribute('aria-describedby') ?? ''
    expect(described.split(' ')).toHaveLength(2)
    expect(screen.getByRole('alert').textContent).toBe('Juda qisqa')
  })
})
