import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { tenantId } from '../../api/request'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { CoveragePackageTerms, coveragePackageTerms } from '../../components/CoveragePackageTerms'
import type { SubmissionField } from '../../api/submissions.api'

export function SubmissionPackageTerms({ product, fields }: { product: string; fields: SubmissionField[] }) {
  const config = useQuery({ queryKey: ['submission-package-terms', tenantId(), product], queryFn: () => api.getProductConfig(product), retry: false })
  return <CollapsibleSection title="Package terms" className="si-card">
    {config.isPending && <p role="status">Loading package terms...</p>}
    {config.isError && <p role="alert">Package terms could not be loaded.</p>}
    {config.data?.coverages?.filter((definition: any) => definition.required || fields.some(field => field.key.startsWith(`cov.${definition.code}.`))).map((definition: any) => {
      const limit = fields.find(field => field.key === `cov.${definition.code}.limit`)?.value
      return <div key={definition.code}><h4>{definition.name}</h4>
        <CoveragePackageTerms terms={coveragePackageTerms(definition, { limit }, false)} />
      </div>
    })}
  </CollapsibleSection>
}
