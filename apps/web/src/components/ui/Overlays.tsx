import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { classes } from './foundations/utils'
import './Overlays.css'

const focusableSelector =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
const useSafeLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

interface InlineStyleValue {
  value: string
  priority: string
}

interface DocumentScrollLock {
  count: number
  rootOverflow: InlineStyleValue
  bodyOverflow: InlineStyleValue
}

const documentScrollLocks = new WeakMap<Document, DocumentScrollLock>()

function readInlineStyle(
  element: HTMLElement,
  property: string,
): InlineStyleValue {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  }
}

function restoreInlineStyle(
  element: HTMLElement,
  property: string,
  previous: InlineStyleValue,
) {
  if (previous.value)
    element.style.setProperty(property, previous.value, previous.priority)
  else element.style.removeProperty(property)
}

function lockDocumentScroll(ownerDocument: Document) {
  const activeLock = documentScrollLocks.get(ownerDocument)
  if (activeLock) activeLock.count += 1
  else {
    documentScrollLocks.set(ownerDocument, {
      count: 1,
      rootOverflow: readInlineStyle(ownerDocument.documentElement, 'overflow'),
      bodyOverflow: readInlineStyle(ownerDocument.body, 'overflow'),
    })
    ownerDocument.documentElement.style.setProperty('overflow', 'hidden')
    ownerDocument.body.style.setProperty('overflow', 'hidden')
  }

  let released = false
  return () => {
    if (released) return
    released = true
    const lock = documentScrollLocks.get(ownerDocument)
    if (!lock) return
    lock.count -= 1
    if (lock.count > 0) return
    restoreInlineStyle(
      ownerDocument.documentElement,
      'overflow',
      lock.rootOverflow,
    )
    restoreInlineStyle(ownerDocument.body, 'overflow', lock.bodyOverflow)
    documentScrollLocks.delete(ownerDocument)
  }
}

interface OverlayPosition {
  left: number
  top: number
}

export interface FlyoutTriggerProps {
  'aria-controls': string
  'aria-expanded': boolean
  'aria-haspopup': 'dialog'
  onClick: () => void
  ref: (node: HTMLButtonElement | null) => void
}

export interface FlyoutProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'content'> {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: (props: FlyoutTriggerProps) => ReactNode
  children: ReactNode
  placement?: 'start' | 'end'
  label: string
  collisionBoundary?: 'viewport' | 'parent'
}

interface FlyoutPosition extends OverlayPosition {
  minWidth: number
  maxWidth: number
  verticalPlacement: 'above' | 'below'
}

export const Flyout = forwardRef<HTMLDivElement, FlyoutProps>(function Flyout(
  {
    open,
    onOpenChange,
    trigger,
    children,
    placement = 'start',
    label,
    collisionBoundary = 'parent',
    className,
    ...props
  },
  forwardedRef,
) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousOpenRef = useRef(false)
  const [position, setPosition] = useState<FlyoutPosition>({
    left: -9999,
    top: -9999,
    minWidth: 210,
    maxWidth: 320,
    verticalPlacement: 'below',
  })

  const setRootRef = (node: HTMLDivElement | null) => {
    rootRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }

  const updatePosition = useCallback(() => {
    const root = rootRef.current
    const triggerElement = triggerRef.current
    const content = contentRef.current
    if (!root || !triggerElement || !content || typeof window === 'undefined')
      return

    const viewportMargin = 8
    const parentRect =
      collisionBoundary === 'parent'
        ? root.parentElement?.getBoundingClientRect()
        : undefined
    const boundaryLeft = Math.max(
      viewportMargin,
      parentRect?.left ?? viewportMargin,
    )
    const boundaryRight = Math.min(
      window.innerWidth - viewportMargin,
      parentRect?.right ?? window.innerWidth - viewportMargin,
    )
    const availableWidth = Math.max(1, boundaryRight - boundaryLeft)
    const contentRect = content.getBoundingClientRect()
    const triggerRect = triggerElement.getBoundingClientRect()
    const width = Math.min(contentRect.width, availableWidth)
    const direction = getComputedStyle(root).direction
    const alignToLeft =
      (placement === 'start' && direction !== 'rtl') ||
      (placement === 'end' && direction === 'rtl')
    let left = alignToLeft ? triggerRect.left : triggerRect.right - width
    left = Math.min(
      Math.max(left, boundaryLeft),
      Math.max(boundaryLeft, boundaryRight - width),
    )

    const gap = 5
    const roomBelow = window.innerHeight - viewportMargin - triggerRect.bottom
    const roomAbove = triggerRect.top - viewportMargin
    const verticalPlacement =
      roomBelow >= contentRect.height + gap || roomBelow >= roomAbove
        ? 'below'
        : 'above'
    let top =
      verticalPlacement === 'below'
        ? triggerRect.bottom + gap
        : triggerRect.top - gap - contentRect.height
    top = Math.min(
      Math.max(top, viewportMargin),
      Math.max(
        viewportMargin,
        window.innerHeight - contentRect.height - viewportMargin,
      ),
    )

    setPosition({
      left,
      top,
      minWidth: Math.min(210, availableWidth),
      maxWidth: Math.min(320, availableWidth),
      verticalPlacement,
    })
  }, [collisionBoundary, placement])

  useSafeLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const frame = requestAnimationFrame(() => {
      updatePosition()
      const target =
        contentRef.current?.querySelector<HTMLElement>(focusableSelector) ??
        contentRef.current
      target?.focus()
    })
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      )
        onOpenChange(false)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onOpenChange(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [onOpenChange, open, updatePosition])

  useEffect(() => {
    if (previousOpenRef.current && !open) triggerRef.current?.focus()
    previousOpenRef.current = open
  }, [open])

  return (
    <div
      ref={setRootRef}
      className={classes('ui-flyout', className)}
      {...props}
    >
      {trigger({
        'aria-controls': id,
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        onClick: () => onOpenChange(!open),
        ref: (node) => {
          triggerRef.current = node
        },
      })}
      {open && (
        <div
          ref={contentRef}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className="ui-flyout-content"
          data-vertical-placement={position.verticalPlacement}
          style={{
            position: 'fixed',
            left: position.left,
            top: position.top,
            minWidth: position.minWidth,
            maxWidth: position.maxWidth,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
})

export interface DialogProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  portalRoot: Element | DocumentFragment | null | undefined
  initialFocusRef?: React.RefObject<HTMLElement | null>
  closeLabel?: string
}

export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog(
  {
    open,
    onOpenChange,
    title,
    description,
    children,
    footer,
    portalRoot,
    initialFocusRef,
    closeLabel = 'Close dialog',
    className,
    ...props
  }: DialogProps,
  forwardedRef,
) {
  const titleId = useId()
  const descriptionId = useId()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const setSurfaceRef = (node: HTMLDivElement | null) => {
    surfaceRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }

  useEffect(() => {
    if (!open) return
    const surface = surfaceRef.current
    const ownerDocument = surface?.ownerDocument ?? document
    returnFocusRef.current =
      ownerDocument.activeElement instanceof HTMLElement
        ? ownerDocument.activeElement
        : null
    const target =
      initialFocusRef?.current ??
      surface?.querySelector<HTMLElement>(focusableSelector)
    target?.focus()
    return () => returnFocusRef.current?.focus()
  }, [initialFocusRef, open])

  useEffect(() => {
    if (!open || !portalRoot) return
    const ownerDocument = portalRoot.ownerDocument
    if (!ownerDocument?.body) return
    return lockDocumentScroll(ownerDocument)
  }, [open, portalRoot])

  if (!open || typeof document === 'undefined' || !portalRoot) return null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onOpenChange(false)
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      surfaceRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ??
        [],
    )
    const ownerDocument = surfaceRef.current?.ownerDocument ?? document
    if (focusable.length === 0) {
      event.preventDefault()
      surfaceRef.current?.focus()
      return
    }
    const first = focusable.at(0)
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && ownerDocument.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && ownerDocument.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const dialog = (
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <div
        ref={setSurfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={
          description !== undefined && description !== null
            ? descriptionId
            : undefined
        }
        tabIndex={-1}
        className={classes('ui-dialog', className)}
        onKeyDown={handleKeyDown}
        {...props}
      >
        <header className="ui-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description !== undefined && description !== null && (
              <p id={descriptionId}>{description}</p>
            )}
          </div>
          <button
            type="button"
            className="ui-dialog-close"
            aria-label={closeLabel}
            onClick={() => onOpenChange(false)}
          >
            ×
          </button>
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer !== undefined && footer !== null && (
          <footer className="ui-dialog-footer">{footer}</footer>
        )}
      </div>
    </div>
  )

  return createPortal(dialog, portalRoot)
})
