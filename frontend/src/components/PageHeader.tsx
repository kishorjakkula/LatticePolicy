import React from 'react'

// Layout only; colours, radii and fonts come from the --ps-* design tokens.
const styles = {
  titleRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  title: { margin: 0, minWidth: 0, overflowWrap: 'anywhere' },
  status: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  facts: { display: 'flex', flexWrap: 'wrap', gap: '12px 28px', marginTop: 14 },
  fact: { minWidth: 0, maxWidth: '100%' },
  factLabel: { color: 'var(--ps-text-secondary)', fontSize: '0.78rem', fontWeight: 600, marginBottom: 2 },
  factValue: { color: 'var(--ps-text)', fontWeight: 600, overflowWrap: 'anywhere' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14 },
} satisfies Record<string, React.CSSProperties>

export interface PageHeaderProps {
  /** Page title; rendered as the page's h1. */
  title: React.ReactNode
  /** Breadcrumb trail rendered above the header card. */
  breadcrumbs?: React.ReactNode
  /** Key facts, usually a list of PageHeaderFact. */
  facts?: React.ReactNode
  /** Status badge(s), shown at the end of the title row. */
  status?: React.ReactNode
  /** Primary and secondary actions for the page. */
  actions?: React.ReactNode
  /** Classes for the header card, e.g. existing card styling. */
  className?: string
  'data-testid'?: string
}

/**
 * Standard page header: identity (title + key facts), status and the page's
 * actions in one place, so record pages read the same way.
 */
export function PageHeader({ title, breadcrumbs, facts, status, actions, className, ...rest }: PageHeaderProps) {
  return (
    <>
      {breadcrumbs}
      <header className={['ps-record-header', className].filter(Boolean).join(' ')} data-testid={rest['data-testid']}>
        <div style={styles.titleRow}>
          <h1 className="ps-page-title" style={styles.title}>
            {title}
          </h1>
          {status && <div style={styles.status}>{status}</div>}
        </div>
        {facts && (
          <dl style={{ ...styles.facts, margin: 0, marginTop: styles.facts.marginTop }}>
            {facts}
          </dl>
        )}
        {actions && <div style={styles.actions}>{actions}</div>}
      </header>
    </>
  )
}

export interface PageHeaderFactProps {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}

/** One labelled key fact inside PageHeader's facts slot. */
export function PageHeaderFact({ label, children, className }: PageHeaderFactProps) {
  return (
    <div style={styles.fact} className={className}>
      <dt style={styles.factLabel}>{label}</dt>
      <dd style={{ ...styles.factValue, margin: 0 }}>{children}</dd>
    </div>
  )
}
