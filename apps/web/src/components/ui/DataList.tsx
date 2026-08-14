import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { classes } from './foundations/utils'
import './DataList.css'

export const DataList = forwardRef<
  HTMLDListElement,
  HTMLAttributes<HTMLDListElement>
>(function DataList({ className, ...props }, ref) {
  return (
    <dl ref={ref} className={classes('ui-data-list', className)} {...props} />
  )
})

export interface DataListItemProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'label'> {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
}

export const DataListItem = forwardRef<HTMLDivElement, DataListItemProps>(
  function DataListItem({ label, value, detail, className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={classes('ui-data-list-item', className)}
        {...props}
      >
        <dt>{label}</dt>
        <dd>
          {value}
          {detail !== undefined && detail !== null && <small>{detail}</small>}
        </dd>
      </div>
    )
  },
)
