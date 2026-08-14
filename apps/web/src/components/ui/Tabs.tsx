import {
  forwardRef,
  useId,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { classes } from './foundations/utils'
import './Tabs.css'

export interface TabItem {
  id: string
  label: ReactNode
  content: ReactNode
  badge?: ReactNode
}

export interface TabsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: TabItem[]
  activeId: string
  onActiveChange: (id: string) => void
  label: string
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { items, activeId, onActiveChange, label, className, ...props },
  ref,
) {
  const prefix = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const active = items.find((item) => item.id === activeId) ?? items[0]

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (
      !active ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      return
    event.preventDefault()
    const direction = getComputedStyle(event.currentTarget).direction
    const forward = direction === 'rtl' ? -1 : 1
    const delta = event.key === 'ArrowRight' ? forward : -forward
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + delta + items.length) % items.length
    const nextItem = items[next]
    if (!nextItem) return
    onActiveChange(nextItem.id)
    refs.current[next]?.focus()
  }

  return (
    <div ref={ref} className={classes('ui-tabs', className)} {...props}>
      <div role="tablist" aria-label={label} className="ui-tab-list">
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[index] = node
            }}
            id={`${prefix}-tab-${item.id}`}
            role="tab"
            aria-selected={item.id === active?.id}
            aria-controls={`${prefix}-panel-${item.id}`}
            tabIndex={item.id === active?.id ? 0 : -1}
            onClick={() => onActiveChange(item.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {item.label}
            {item.badge && <b>{item.badge}</b>}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${prefix}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${prefix}-tab-${item.id}`}
          className="ui-tab-panel"
          hidden={item.id !== active?.id}
        >
          {item.content}
        </div>
      ))}
    </div>
  )
})
