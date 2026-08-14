import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { classes } from './foundations/utils'
import './Button.css'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'secondary' | 'danger' | 'quiet' | 'neutral' | undefined
  size?: 'small' | 'medium' | undefined
  fullWidth?: boolean | undefined
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      tone = 'secondary',
      size = 'medium',
      fullWidth = false,
      className,
      type = 'button',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={classes(
          'ui-button',
          `ui-button--${tone}`,
          `ui-button--${size}`,
          fullWidth && 'ui-button--full',
          className,
        )}
        {...props}
      />
    )
  },
)

export interface IconButtonProps
  extends Omit<ButtonProps, 'children' | 'aria-label'> {
  label: string
  icon: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, icon, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        aria-label={label}
        className={classes('ui-icon-button', className)}
        {...props}
      >
        {icon}
      </Button>
    )
  },
)
