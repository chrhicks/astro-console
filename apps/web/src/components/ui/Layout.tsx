import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'
import { classes } from './foundations/utils'
import './Layout.css'

type LayoutProps = HTMLAttributes<HTMLDivElement> & { gap?: number | string }

function gapStyle(
  gap: number | string | undefined,
  style: CSSProperties | undefined,
): CSSProperties {
  return {
    ...style,
    ...(gap == null
      ? {}
      : ({
          '--ui-layout-gap': typeof gap === 'number' ? `${gap}px` : gap,
        } as CSSProperties)),
  }
}

export const Stack = forwardRef<HTMLDivElement, LayoutProps>(function Stack(
  { gap, className, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={classes('ui-stack', className)}
      style={gapStyle(gap, style)}
      {...props}
    />
  )
})

export const Cluster = forwardRef<HTMLDivElement, LayoutProps>(function Cluster(
  { gap, className, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={classes('ui-cluster', className)}
      style={gapStyle(gap, style)}
      {...props}
    />
  )
})
