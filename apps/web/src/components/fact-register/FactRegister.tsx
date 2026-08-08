import type { StatusTone } from '../../presentation'
import './style.css'

export type Fact = {
  label: string
  value: string
  tone?: StatusTone
}

/**
 * Aligned fact register — label/value rows with tabular numerals and a
 * 12px floor. Facts reflow; they never truncate and never hide behind
 * hover. Tone colors a value only as reinforcement of its text.
 */
export function FactRegister({
  facts,
  className,
}: {
  facts: readonly Fact[]
  className?: string
}) {
  return (
    <dl className={`fact-register${className ? ` ${className}` : ''}`}>
      {facts.map((fact) => (
        <div key={fact.label} className="fact-register__row">
          <dt>{fact.label}</dt>
          <dd {...(fact.tone === undefined ? {} : { 'data-tone': fact.tone })}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
