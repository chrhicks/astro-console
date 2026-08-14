import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react'
import { classes } from './foundations/utils'
import './FormControls.css'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      invalid = false,
      className,
      type = 'text',
      'aria-invalid': ariaInvalid,
      ...props
    },
    ref,
  ) {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || ariaInvalid || undefined}
        className={classes('ui-text-field', className)}
        {...props}
      />
    )
  },
)

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={classes('ui-checkbox', className)}
        {...props}
      />
    )
  },
)

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { invalid = false, className, 'aria-invalid': ariaInvalid, ...props },
    ref,
  ) {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || ariaInvalid || undefined}
        className={classes('ui-select', className)}
        {...props}
      />
    )
  },
)

export interface NumberFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  invalid?: boolean
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(
  function NumberField(
    { invalid = false, className, 'aria-invalid': ariaInvalid, ...props },
    ref,
  ) {
    return (
      <input
        ref={ref}
        type="number"
        inputMode="decimal"
        aria-invalid={invalid || ariaInvalid || undefined}
        className={classes('ui-number-field', className)}
        {...props}
      />
    )
  },
)
