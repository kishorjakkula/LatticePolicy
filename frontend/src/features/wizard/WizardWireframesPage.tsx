type WireframeStep = {
  title: string
  subtitle: string
  active?: boolean
}

const compactRailSteps: WireframeStep[] = [
  { title: 'Product', subtitle: 'Carrier & distribution', active: true },
  { title: 'Qualification', subtitle: 'Eligibility checks' },
  { title: 'Insureds', subtitle: 'Named insureds' },
  { title: 'Risk', subtitle: 'Risk details' },
  { title: 'Coverages', subtitle: 'Coverage selections' },
  { title: 'Rating', subtitle: 'Rate and validate' },
  { title: 'Premium', subtitle: 'Premium results' },
  { title: 'Review', subtitle: 'Bind and issue' }
]

function WireframeField({
  label,
  value,
  tone = 'default',
  wide = false
}: {
  label: string
  value: string
  tone?: 'default' | 'muted' | 'empty'
  wide?: boolean
}) {
  return (
    <div className={`wireframe-field ${wide ? 'is-wide' : ''}`}>
      <span className="wireframe-label">{label}</span>
      <div className={`wireframe-input ${tone !== 'default' ? `is-${tone}` : ''}`}>{value}</div>
    </div>
  )
}

function CompactRail() {
  return (
    <div className="wireframe-stage compact-rail-layout">
      <aside className="wireframe-sidebar">
        <div className="wireframe-sidebar-top">
          <span className="wireframe-kicker">Quote Setup</span>
          <span className="wireframe-count">Step 1 of 8</span>
        </div>
        <div className="wireframe-progress" aria-hidden="true">
          <span style={{ width: '18%' }} />
        </div>
        <div className="wireframe-step-list">
          {compactRailSteps.map((step) => (
            <div key={step.title} className={`wireframe-step ${step.active ? 'is-active' : ''}`}>
              <span className="wireframe-step-dot" aria-hidden="true" />
              <div>
                <div className="wireframe-step-title">{step.title}</div>
                <div className="wireframe-step-subtitle">{step.subtitle}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div className="wireframe-panel">
        <div className="wireframe-panel-head">
          <div>
            <div className="wireframe-panel-title">Carrier & Distribution</div>
            <div className="wireframe-panel-copy">A quieter left rail and cleaner form rows keep the setup focused.</div>
          </div>
          <span className="wireframe-chip">Recommended</span>
        </div>
        <div className="wireframe-form-grid two-col">
          <WireframeField label="Underwriting Company" value="UW Company USA 1" wide />
          <WireframeField label="Agency" value="Stonebridge Insurance" />
          <WireframeField label="Agency Contact" value="Maya Chen" />
          <WireframeField label="Effective Date" value="03/03/2026" />
          <WireframeField label="Term" value="12 months" />
          <WireframeField label="Country" value="USA" />
          <WireframeField label="State" value="Pennsylvania" />
          <WireframeField label="Product" value="Commercial Auto" />
        </div>
        <div className="wireframe-footer">
          <button type="button" className="wireframe-button is-secondary">Back</button>
          <div className="wireframe-footer-right">
            <button type="button" className="wireframe-button is-secondary">Save Draft</button>
            <button type="button" className="wireframe-button is-primary">Continue</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function GuidedForm() {
  return (
    <div className="wireframe-stage guided-layout">
      <div className="wireframe-guided-head">
        <div>
          <div className="wireframe-kicker">New Quote</div>
          <div className="wireframe-panel-title">Single-Path Setup</div>
        </div>
        <span className="wireframe-count">Step 1 of 8</span>
      </div>
      <div className="wireframe-panel-copy">
        One reading path, fewer choices per row, and plain labels for faster completion.
      </div>
      <div className="wireframe-form-grid one-col">
        <WireframeField label="Underwriting Company" value="UW Company USA 1" />
        <WireframeField label="Agency" value="Stonebridge Insurance" />
        <WireframeField label="Agency Contact" value="Maya Chen" />
        <WireframeField label="Effective Date" value="03/03/2026" />
        <div className="wireframe-inline-pair">
          <WireframeField label="Country" value="USA" />
          <WireframeField label="State" value="Pennsylvania" />
        </div>
        <div className="wireframe-inline-pair">
          <WireframeField label="Product" value="Commercial Auto" />
          <WireframeField label="Term" value="12 months" />
        </div>
      </div>
      <div className="wireframe-footer">
        <button type="button" className="wireframe-button is-secondary">Save Draft</button>
        <button type="button" className="wireframe-button is-primary">Next</button>
      </div>
    </div>
  )
}

function ChecklistFlow() {
  return (
    <div className="wireframe-stage checklist-layout">
      <div className="wireframe-guided-head">
        <div>
          <div className="wireframe-kicker">Quote Setup</div>
          <div className="wireframe-panel-title">Checklist Wizard</div>
        </div>
        <span className="wireframe-count">4 items</span>
      </div>
      <div className="wireframe-checklist">
        <div className="wireframe-check-row">
          <span className="wireframe-check-index">1</span>
          <div className="wireframe-check-copy">
            <div className="wireframe-step-title">Carrier</div>
            <div className="wireframe-step-subtitle">Pick the underwriting company.</div>
          </div>
          <div className="wireframe-check-value">UW Company USA 1</div>
        </div>
        <div className="wireframe-check-row">
          <span className="wireframe-check-index">2</span>
          <div className="wireframe-check-copy">
            <div className="wireframe-step-title">Distribution</div>
            <div className="wireframe-step-subtitle">Set agency and contact.</div>
          </div>
          <div className="wireframe-check-value">Agency + Contact</div>
        </div>
        <div className="wireframe-check-row">
          <span className="wireframe-check-index">3</span>
          <div className="wireframe-check-copy">
            <div className="wireframe-step-title">Policy Basics</div>
            <div className="wireframe-step-subtitle">Effective date and term.</div>
          </div>
          <div className="wireframe-check-value">03/03/2026, 12 months</div>
        </div>
        <div className="wireframe-check-row">
          <span className="wireframe-check-index">4</span>
          <div className="wireframe-check-copy">
            <div className="wireframe-step-title">Eligibility Context</div>
            <div className="wireframe-step-subtitle">Country, state, and product.</div>
          </div>
          <div className="wireframe-check-value is-open">Needs review</div>
        </div>
      </div>
      <div className="wireframe-footer">
        <button type="button" className="wireframe-button is-secondary">Save Draft</button>
        <button type="button" className="wireframe-button is-primary">Continue</button>
      </div>
    </div>
  )
}

function SectionBands() {
  return (
    <div className="wireframe-stage stacked-sections-layout">
      <div className="wireframe-guided-head">
        <div>
          <div className="wireframe-kicker">Quote Setup</div>
          <div className="wireframe-panel-title">Section Bands</div>
        </div>
        <span className="wireframe-count">Step 1 of 8</span>
      </div>
      <div className="wireframe-mini-progress" aria-hidden="true">
        <span style={{ width: '20%' }} />
      </div>

      <div className="wireframe-band">
        <div className="wireframe-band-head">
          <div className="wireframe-step-title">1. Carrier</div>
          <span className="wireframe-inline-chip">Required</span>
        </div>
        <div className="wireframe-form-grid one-col">
          <WireframeField label="Underwriting Company" value="UW Company USA 1" />
        </div>
      </div>

      <div className="wireframe-band">
        <div className="wireframe-band-head">
          <div className="wireframe-step-title">2. Distribution</div>
          <span className="wireframe-inline-chip">Required</span>
        </div>
        <div className="wireframe-inline-pair">
          <WireframeField label="Agency" value="Stonebridge Insurance" />
          <WireframeField label="Agency Contact" value="Maya Chen" />
        </div>
      </div>

      <div className="wireframe-band">
        <div className="wireframe-band-head">
          <div className="wireframe-step-title">3. Policy Basics</div>
          <span className="wireframe-inline-chip">Required</span>
        </div>
        <div className="wireframe-form-grid two-col">
          <WireframeField label="Effective Date" value="03/03/2026" />
          <WireframeField label="Term" value="12 months" />
          <WireframeField label="Country" value="USA" />
          <WireframeField label="State" value="Pennsylvania" />
          <WireframeField label="Product" value="Commercial Auto" wide />
        </div>
      </div>

      <div className="wireframe-footer">
        <button type="button" className="wireframe-button is-secondary">Save Draft</button>
        <button type="button" className="wireframe-button is-primary">Continue</button>
      </div>
    </div>
  )
}

function SummarySplit() {
  return (
    <div className="wireframe-stage summary-split-layout">
      <div className="wireframe-panel">
        <div className="wireframe-panel-head">
          <div>
            <div className="wireframe-kicker">Quote Setup</div>
            <div className="wireframe-panel-title">Form + Context</div>
          </div>
          <span className="wireframe-count">Step 1 of 8</span>
        </div>
        <div className="wireframe-form-grid two-col">
          <WireframeField label="Underwriting Company" value="UW Company USA 1" wide />
          <WireframeField label="Agency" value="Stonebridge Insurance" />
          <WireframeField label="Agency Contact" value="Maya Chen" />
          <WireframeField label="Effective Date" value="03/03/2026" />
          <WireframeField label="Term" value="12 months" />
          <WireframeField label="Country" value="USA" />
          <WireframeField label="State" value="Pennsylvania" />
          <WireframeField label="Product" value="Commercial Auto" />
        </div>
        <div className="wireframe-footer">
          <button type="button" className="wireframe-button is-secondary">Back</button>
          <button type="button" className="wireframe-button is-primary">Continue</button>
        </div>
      </div>

      <aside className="wireframe-side-summary">
        <div className="wireframe-step-title">What this step sets up</div>
        <div className="wireframe-panel-copy">
          This version keeps the form compact but adds a plain summary panel so users know why each choice matters.
        </div>
        <div className="wireframe-summary-list">
          <div className="wireframe-summary-row">
            <span className="wireframe-summary-label">Carrier</span>
            <span className="wireframe-summary-text">Controls available products and state filing rules.</span>
          </div>
          <div className="wireframe-summary-row">
            <span className="wireframe-summary-label">Agency</span>
            <span className="wireframe-summary-text">Sets producer, contact, and commission defaults.</span>
          </div>
          <div className="wireframe-summary-row">
            <span className="wireframe-summary-label">Location</span>
            <span className="wireframe-summary-text">Narrows product availability to the correct jurisdiction.</span>
          </div>
          <div className="wireframe-summary-row">
            <span className="wireframe-summary-label">Product</span>
            <span className="wireframe-summary-text">Unlocks the rest of the wizard and underwriting questions.</span>
          </div>
        </div>
        <div className="wireframe-side-note">
          Users who need more context often complete this version faster because there is less ambiguity.
        </div>
      </aside>
    </div>
  )
}

export default function WizardWireframesPage() {
  return (
    <div className="card page-shell wizard-wireframes-page">
      <div className="wizard-wireframes-head">
        <div>
          <span className="wireframe-kicker">UI Review</span>
          <h2>Quote Wizard Wireframes</h2>
          <p className="muted">
            Five lighter mockups for the first wizard step. These are static previews so you can compare layout direction before I refactor the live screen.
          </p>
        </div>
        <div className="wizard-wireframes-summary">
          <div className="wizard-wireframes-summary-label">Best starting point</div>
          <div className="wizard-wireframes-summary-value">Compact Rail</div>
          <div className="muted">Keeps the current mental model, but removes most of the visual noise.</div>
        </div>
      </div>

      <div className="wizard-wireframes-grid">
        <section className="wizard-wireframe-card">
          <div className="wizard-wireframe-card-head">
            <h3>Option A</h3>
            <span className="wizard-wireframe-badge">Compact Rail</span>
          </div>
          <p className="muted">Two-panel layout with a quieter step rail and a cleaner setup panel.</p>
          <CompactRail />
        </section>

        <section className="wizard-wireframe-card">
          <div className="wizard-wireframe-card-head">
            <h3>Option B</h3>
            <span className="wizard-wireframe-badge">Guided Form</span>
          </div>
          <p className="muted">Single-column flow for the simplest first-time user experience.</p>
          <GuidedForm />
        </section>

        <section className="wizard-wireframe-card">
          <div className="wizard-wireframe-card-head">
            <h3>Option C</h3>
            <span className="wizard-wireframe-badge">Checklist</span>
          </div>
          <p className="muted">Task-oriented layout that frames setup as a short completion list.</p>
          <ChecklistFlow />
        </section>

        <section className="wizard-wireframe-card">
          <div className="wizard-wireframe-card-head">
            <h3>Option D</h3>
            <span className="wizard-wireframe-badge">Section Bands</span>
          </div>
          <p className="muted">Breaks the page into short grouped sections so each decision feels smaller.</p>
          <SectionBands />
        </section>

        <section className="wizard-wireframe-card">
          <div className="wizard-wireframe-card-head">
            <h3>Option E</h3>
            <span className="wizard-wireframe-badge">Summary Split</span>
          </div>
          <p className="muted">Keeps the form simple while adding plain guidance on the right.</p>
          <SummarySplit />
        </section>
      </div>
    </div>
  )
}
