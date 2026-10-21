import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'
import { hasCustomerIdentity } from './RouteGuards'
import { useWorkCounts, type WorkCounts } from './useWorkCounts'
import './app-nav.css'

type UserLike = { roles?: string[]; permissions?: string[]; customerId?: string | null; customerKey?: string | null } | null | undefined

/** Which header count a link carries (REQ-5). */
export type WorkCountKey = keyof WorkCounts

export type AppNavLink = {
  kind: 'link'
  id: string
  path: string
  label: string
  /** Extra paths that also mark this link active (e.g. policy detail under Policies). */
  activePrefixes?: string[]
  countKey?: WorkCountKey
}

export type AppNavGroup = {
  kind: 'group'
  id: string
  label: string
  items: AppNavLink[]
}

export type AppNavEntry = AppNavLink | AppNavGroup

type LinkSpec = Omit<AppNavLink, 'kind'> & {
  /** Every permission listed is required; these mirror the route guards in App.tsx. */
  permissions: string[]
  /** Extra condition beyond permissions (portal needs a customer identity). */
  when?: (user: UserLike) => boolean
}

// Header model. Each link keeps the menu permission it had before WP-0004 and
// adds the page permission its route enforces, so a link never leads to a
// redirect. Order follows 03-ui-design.md: Home, Work, Policies, Customers,
// Rating, Admin.
const HOME: LinkSpec = { id: 'home', path: '/dashboard', label: 'Home', permissions: ['menu.search.view'] }
const WORK: LinkSpec[] = [
  { id: 'submissions', path: '/submissions', label: 'Submissions', permissions: ['menu.submissions.view', 'page.submissions.view'], countKey: 'submissions' },
  { id: 'referrals', path: '/uw/queue', label: 'Referrals', permissions: ['menu.uw_queue.view', 'page.uw_queue.view'], activePrefixes: ['/uw/'], countKey: 'referrals' },
  { id: 'placements', path: '/placements', label: 'Placements', permissions: ['menu.placements.view', 'page.placements.view'] },
]
const AFTER_WORK: LinkSpec[] = [
  { id: 'policies', path: '/search', label: 'Policies', permissions: ['menu.search.view'], activePrefixes: ['/policies/', '/wizard'] },
  {
    id: 'customers',
    path: '/admin/customers',
    label: 'Customers',
    permissions: ['menu.admin.view', 'menu.admin.customers.view', 'page.admin.customers.view'],
    activePrefixes: ['/customers/'],
  },
  { id: 'rating', path: '/rating', label: 'Rating', permissions: ['menu.rating.view'] },
  { id: 'portal', path: '/portal', label: 'Portal', permissions: ['menu.portal.view'], when: hasCustomerIdentity },
  { id: 'admin', path: '/admin', label: 'Admin', permissions: ['menu.admin.view'] },
]

function allowed(user: UserLike, spec: LinkSpec): boolean {
  return spec.permissions.every((code) => hasPermission(user, code)) && (!spec.when || spec.when(user))
}

function toLink({ permissions: _permissions, when: _when, ...link }: LinkSpec): AppNavLink {
  return { kind: 'link', ...link }
}

/** The header entries this user may see, in display order. Empty groups are dropped. */
export function buildAppNavModel(user: UserLike): AppNavEntry[] {
  const entries: AppNavEntry[] = []
  if (allowed(user, HOME)) entries.push(toLink(HOME))
  const work = WORK.filter((spec) => allowed(user, spec)).map(toLink)
  if (work.length) entries.push({ kind: 'group', id: 'work', label: 'Work', items: work })
  entries.push(...AFTER_WORK.filter((spec) => allowed(user, spec)).map(toLink))
  return entries
}

/** Permissions needed before the header asks the API for a count. */
export function workCountPermissions(user: UserLike) {
  return {
    referrals: ['menu.uw_queue.view', 'page.uw_queue.view', 'uw.referrals.read'].every((code) => hasPermission(user, code)),
    submissions: ['menu.submissions.view', 'page.submissions.view', 'submissions.read'].every((code) => hasPermission(user, code)),
  }
}

const COUNT_WORDS: Record<WorkCountKey, string> = { referrals: 'open', submissions: 'to review' }

function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(path.endsWith('/') ? path : `${path}/`)
}

function isLinkActive(link: AppNavLink, pathname: string): boolean {
  // Customers lives under /admin; keep Admin from lighting up for it.
  if (link.id === 'admin' && matchesPath(pathname, '/admin/customers')) return false
  return [link.path, ...(link.activePrefixes || [])].some((path) => matchesPath(pathname, path))
}

function NavItemLink({ link, count, onNavigate, pathname }: { link: AppNavLink; count?: number; onNavigate?: () => void; pathname: string }) {
  const active = isLinkActive(link, pathname)
  const hasCount = link.countKey !== undefined && typeof count === 'number'
  return (
    <Link
      to={link.path}
      onClick={onNavigate}
      className={`app-nav-link${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="app-nav-label">{link.label}</span>
      {hasCount && (
        <>
          <span className="app-nav-count" aria-hidden="true">{count}</span>
          <span className="sr-only">{`, ${count} ${COUNT_WORDS[link.countKey!]}`}</span>
        </>
      )}
    </Link>
  )
}

function WorkMenu({ group, counts, pathname }: { group: AppNavGroup; counts: WorkCounts; pathname: string }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const active = group.items.some((item) => isLinkActive(item, pathname))

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="app-nav-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`app-nav-link app-nav-menu-button${active ? ' active' : ''}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="app-nav-label">{group.label}</span>
        <svg className="app-nav-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul id={menuId} className="app-nav-menu-list" hidden={!open}>
        {group.items.map((item) => (
          <li key={item.id}>
            <NavItemLink link={item} count={item.countKey ? counts[item.countKey] : undefined} pathname={pathname} onNavigate={() => setOpen(false)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Global header navigation (REQ-5). Desktop shows a link row with a Work menu;
 * phones (≤900px) show a menu button that opens a sheet with the same groups
 * and counts. Links are filtered by permission; the route guards in App.tsx
 * and the API still enforce access.
 */
export function AppNav() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [sheetOpen, setSheetOpen] = useState(false)
  const entries = buildAppNavModel(user)
  const counts = useWorkCounts(workCountPermissions(user))

  useEffect(() => {
    setSheetOpen(false)
  }, [pathname])

  const closeSheet = () => setSheetOpen(false)

  return (
    <>
      <button
        type="button"
        className="topnav-toggle"
        aria-label="Toggle navigation menu"
        aria-expanded={sheetOpen}
        aria-controls="app-nav-sheet"
        onClick={() => setSheetOpen((open) => !open)}
      >
        {sheetOpen ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <nav id="topnav-main" className="topnav app-nav" aria-label="Main">
        {entries.map((entry) =>
          entry.kind === 'group' ? (
            <WorkMenu key={entry.id} group={entry} counts={counts} pathname={pathname} />
          ) : (
            <NavItemLink key={entry.id} link={entry} pathname={pathname} count={entry.countKey ? counts[entry.countKey] : undefined} />
          ),
        )}
      </nav>

      {sheetOpen && (
        <nav id="app-nav-sheet" className="app-nav-sheet" aria-label="Menu">
          <ul className="app-nav-sheet-list">
            {entries.map((entry) =>
              entry.kind === 'group' ? (
                <li key={entry.id} className="app-nav-sheet-group">
                  <h2 className="app-nav-sheet-heading" id={`app-nav-sheet-${entry.id}`}>{entry.label}</h2>
                  <ul aria-labelledby={`app-nav-sheet-${entry.id}`}>
                    {entry.items.map((item) => (
                      <li key={item.id}>
                        <NavItemLink link={item} pathname={pathname} count={item.countKey ? counts[item.countKey] : undefined} onNavigate={closeSheet} />
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={entry.id}>
                  <NavItemLink link={entry} pathname={pathname} count={entry.countKey ? counts[entry.countKey] : undefined} onNavigate={closeSheet} />
                </li>
              ),
            )}
          </ul>
        </nav>
      )}
    </>
  )
}
