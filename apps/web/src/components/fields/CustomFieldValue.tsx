import type { CustomField } from '@/lib/types'
import { Input } from '@/components/ui/input'

interface CustomFieldValueProps {
  field: CustomField
  value?: string
  onChange?: (value: string) => void
}

export function CustomFieldValue({ field, value: controlledValue, onChange }: CustomFieldValueProps) {
  const value = controlledValue ?? ''

  function handleChange(next: string) {
    onChange?.(next)
  }

  switch (field.field_type) {
    case 'number':
      return (
        <Input
          type="number"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="h-7 text-xs"
          placeholder="--"
        />
      )

    case 'url':
      return (
        <Input
          type="url"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="h-7 text-xs"
          placeholder="https://..."
        />
      )

    case 'date':
      return (
        <Input
          type="date"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="h-7 text-xs"
        />
      )

    case 'text':
    default:
      return (
        <Input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="h-7 text-xs"
          placeholder="--"
        />
      )
  }
}
