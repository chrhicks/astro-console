import { forwardRef, type HTMLAttributes, type KeyboardEvent } from 'react'
import { classes } from './foundations/utils'
import './Toolbar.css'

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  orientation?: 'horizontal' | 'vertical'
}

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  function Toolbar(
    { label, orientation = 'horizontal', className, onKeyDown, ...props },
    ref,
  ) {
    const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      const keys =
        orientation === 'horizontal'
          ? ['ArrowLeft', 'ArrowRight']
          : ['ArrowUp', 'ArrowDown']
      if (!keys.includes(event.key)) return
      const controls = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']",
        ),
      ).filter(
        (control) =>
          control.closest('[role="toolbar"]') === event.currentTarget &&
          !control.closest('[role="dialog"]'),
      )
      const current = controls.findIndex(
        (control) => control === document.activeElement,
      )
      if (current < 0 || controls.length === 0) return
      event.preventDefault()
      const direction =
        orientation === 'horizontal'
          ? getComputedStyle(event.currentTarget).direction
          : 'ltr'
      const forward = direction === 'rtl' ? -1 : 1
      const delta = event.key === keys[1] ? forward : -forward
      controls[(current + delta + controls.length) % controls.length]?.focus()
    }

    return (
      <div
        ref={ref}
        role="toolbar"
        aria-label={label}
        aria-orientation={orientation}
        className={classes(
          'ui-toolbar',
          `ui-toolbar--${orientation}`,
          className,
        )}
        onKeyDown={moveFocus}
        {...props}
      />
    )
  },
)
