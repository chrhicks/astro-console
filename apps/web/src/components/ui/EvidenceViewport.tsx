import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { classes } from './foundations/utils'
import './EvidenceViewport.css'

export interface EvidenceViewportProps extends HTMLAttributes<HTMLElement> {
  media?: ReactNode
  overlays?: ReactNode
  toolbar?: ReactNode
  fallback?: ReactNode
  caption?: ReactNode
  label: string
  aspectRatio?: string
  fit?: 'aspect' | 'fill'
}

export const EvidenceViewport = forwardRef<HTMLElement, EvidenceViewportProps>(
  function EvidenceViewport(
    {
      media,
      overlays,
      toolbar,
      fallback,
      caption,
      label,
      aspectRatio = '16 / 9',
      fit = 'aspect',
      className,
      style,
      ...props
    },
    ref,
  ) {
    return (
      <figure
        ref={ref as never}
        aria-label={label}
        data-fit={fit}
        className={classes('ui-evidence', className)}
        style={
          { ...style, '--ui-evidence-ratio': aspectRatio } as CSSProperties
        }
        {...props}
      >
        <div className="ui-evidence-canvas">
          {media ?? <div className="ui-evidence-fallback">{fallback}</div>}
          {overlays && <div className="ui-evidence-overlays">{overlays}</div>}
        </div>
        {toolbar && <div className="ui-evidence-toolbar">{toolbar}</div>}
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    )
  },
)
