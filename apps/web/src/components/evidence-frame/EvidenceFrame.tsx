import './style.css'

/**
 * EvidenceFrame — the contained evidence surface. A real contained object
 * (image, preview) earns the frame radius; the deterministic placeholder
 * field stands in until retained preview bytes exist. `facts` are plain
 * text on the surface, never pills, never color-only.
 */
export function EvidenceFrame({
  label,
  variant = 'andromeda',
  facts,
  className,
}: {
  label: string
  variant?: 'andromeda' | 'nebula'
  facts?: readonly string[]
  className?: string
}) {
  return (
    <div
      className={`evidence-image evidence-image--${variant}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
    >
      <span className="evidence-image__core" />
      {Array.from({ length: 12 }, (_, index) => (
        <i
          key={index}
          className={`evidence-image__star evidence-image__star--${index + 1}`}
        />
      ))}
      <span className="evidence-image__frame" />
      {facts && facts.length > 0 ? (
        <span className="evidence-frame__facts">{facts.join(' · ')}</span>
      ) : null}
    </div>
  )
}
