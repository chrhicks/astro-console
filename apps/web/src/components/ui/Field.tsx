import {
  cloneElement,
  forwardRef,
  useId,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { TextFieldProps } from './FormControls'
import { classes } from './foundations/utils'
import './Field.css'

interface FieldControlProps {
  id?: string | undefined
  required?: boolean | undefined
  'aria-describedby'?: string | undefined
  'aria-invalid'?: TextFieldProps['aria-invalid'] | undefined
}

export interface FieldProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  requiredLabel?: ReactNode
  children: ReactElement<FieldControlProps>
}

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  {
    label,
    hint,
    error,
    required = false,
    requiredLabel = 'Required',
    children,
    className,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const controlId = children.props.id ?? `${generatedId}-control`
  const hintId = hint ? `${generatedId}-hint` : undefined
  const errorId = error ? `${generatedId}-error` : undefined
  const describedBy =
    [children.props['aria-describedby'], hintId, errorId]
      .filter(Boolean)
      .join(' ') || undefined
  const control = cloneElement(children, {
    id: controlId,
    required: children.props.required ?? required,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : children.props['aria-invalid'],
  })

  return (
    <div
      ref={ref}
      className={classes(
        'ui-field',
        Boolean(error) && 'ui-field--invalid',
        className,
      )}
      {...props}
    >
      <label className="ui-field-label" htmlFor={controlId}>
        <span>{label}</span>
        {required && <b aria-hidden="true">{requiredLabel}</b>}
      </label>
      {control}
      {hint && (
        <small className="ui-field-hint" id={hintId}>
          {hint}
        </small>
      )}
      {error && (
        <small className="ui-field-error" id={errorId}>
          {error}
        </small>
      )}
    </div>
  )
})
