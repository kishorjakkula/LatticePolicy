import { Link } from 'react-router-dom'
import { EmptyState } from './EmptyState'

/** Shown for any route the app does not have. */
export function NotFoundPage() {
  return (
    <section className="page-section" aria-labelledby="not-found-title">
      <h1 id="not-found-title" className="sr-only">Page not found</h1>
      <EmptyState
        title="Page not found"
        description="This address does not match a page in LatticePolicy."
        action={<Link to="/">Go to home</Link>}
      />
    </section>
  )
}
