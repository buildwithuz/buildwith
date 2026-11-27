import type { Meta, StoryObj } from '@storybook/react-vite'
import { Field, Input, Textarea } from './Field'

const meta: Meta = { title: 'Controls/Field' }
export default meta

export const WithHint: StoryObj = {
  render: () => (
    <Field label="Teglar" hint="3 tagacha, vergul bilan: go, postgres">
      {(p) => <Input {...p} placeholder="go, postgres" />}
    </Field>
  ),
}
export const WithError: StoryObj = {
  render: () => (
    <Field label="Sarlavha" error="3-100 belgi">
      {(p) => <Input {...p} defaultValue="ab" />}
    </Field>
  ),
}
export const TextareaField: StoryObj = {
  render: () => <Field label="Tafsilotlar">{(p) => <Textarea {...p} rows={4} />}</Field>,
}
