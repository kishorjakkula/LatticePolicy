import { Link } from 'react-router-dom'

type HeaderOption = {
  id: string
  title: string
  subtitle: string
  badge: string
  previewClass: string
}

const headerOptions: HeaderOption[] = [
  {
    id: 'A',
    title: 'Option A: Blue Steel',
    subtitle: 'A cool blue enterprise header. This keeps the clearest separation from the page body.',
    badge: 'Strong Contrast',
    previewClass: 'header-wireframe-preview--enterprise-blue'
  },
  {
    id: 'B',
    title: 'Option B: Soft Slate',
    subtitle: 'A more neutral blue-gray surface for a quieter enterprise look.',
    badge: 'Balanced Tone',
    previewClass: 'header-wireframe-preview--enterprise-slate'
  },
  {
    id: 'C',
    title: 'Option C: Sage Gray',
    subtitle: 'A subtle green-gray enterprise tone that still reads as a distinct application header.',
    badge: 'Warmest Option',
    previewClass: 'header-wireframe-preview--enterprise-sage'
  }
]

const navItems = ['Dashboard', 'Search', 'Policies', 'Rating', 'Admin']

export default function HeaderWireframesPage() {
  return (
    <div className="ps-page-shell header-wireframes-shell">
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard" className="ps-breadcrumb-link">
          Home
        </Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <span className="ps-breadcrumb-current">Header Wireframes</span>
      </nav>

      <section className="card page-shell policy-hero policy-search-hero">
        <div className="ps-page-header policy-page-header">
            <div className="policy-hero-main">
            <div className="policy-hero-kicker">Color Studies</div>
            <h1 className="ps-page-title">Enterprise Header Color Options</h1>
            <p className="policy-search-subtitle">
              The structure stays the same. Only the header background and accent tone change so you can compare what reads
              best against the current app screens.
            </p>
          </div>
        </div>
      </section>

      <div className="header-wireframe-stack">
        {headerOptions.map((option) => (
          <section key={option.id} className="policy-section-card header-wireframe-card">
            <div className="policy-section-header header-wireframe-card-header">
              <div>
                <h3>{option.title}</h3>
                <p className="muted header-wireframe-caption">{option.subtitle}</p>
              </div>
              <span className="policy-section-count header-wireframe-badge">{option.badge}</span>
            </div>

            <div className={`header-wireframe-preview ${option.previewClass}`}>
              <div className="header-wireframe-bar">
                <div className="header-wireframe-brand-cluster">
                  <div className="header-wireframe-logo-stack">
                    <div className="header-wireframe-logo-tile" aria-hidden="true">
                      <span className="header-wireframe-logo-monogram">LP</span>
                    </div>
                  </div>

                  <div className="header-wireframe-brand-copy">
                    <span className="header-wireframe-carrier-name">LatticePolicy</span>
                  </div>
                </div>

                <div className="header-wireframe-nav-band" aria-label={`${option.title} mock navigation`}>
                  {navItems.map((item) => (
                    <span key={`${option.id}-${item}`} className={`header-wireframe-nav-item${item === 'Policies' ? ' active' : ''}`}>
                      {item}
                    </span>
                  ))}
                </div>

                <div className="header-wireframe-toolbar">
                  <span className="header-wireframe-search-shell">Quick lookup</span>
                  <span className="header-wireframe-user-pill">admin</span>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
