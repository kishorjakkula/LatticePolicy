import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useCreateQuoteMutation, useBindQuoteMutation } from '../../api/hooks'
import { Link, useNavigate } from 'react-router-dom'
import {
  defaultRegionForCountry,
  isRegionInCountry,
  normalizeCountryCode,
  normalizeRegionCode,
  regionsForCountry,
  type CountryCode
} from '../../shared/usStates'

type ProductCode = 'personal-auto' | 'commercial-auto' | 'homeowners' | 'cyber' | 'professional-liability'

type FormValues = {
  productCode: ProductCode
  effectiveDate: string
  termMonths: number
  country: CountryCode
  state: string
  // personal-auto
  garagingZip: string
  annualMiles: number
  driverAge: number
  // homeowners
  address: string
  construction: string
  roofAgeYears: number
  // commercial-auto
  caBusinessName: string
  caGaragingZip: string
  caVehicleCount: number
  caDriverCount: number
  caUseClass: string
  caRadiusClass: string
  caVehicleType: string
  caGvwClass: string
  caAnnualMileage: number
  caYearsInBusiness: number
  caPriorLossesCount: number
  // cyber
  industry: string
  annualRevenue: number
  employeeCount: number
  recordsCount: number
  mfaEnabled: string
  backups: string
  priorIncidents: number
  publicFacingApps: number
  domain: string
  // professional-liability
  plIndustry: string
  plAnnualRevenue: number
  plEmployeeCount: number
  yearsInBusiness: number
  priorClaimsCount: number
  largestContractValue: number
  subcontractorPct: number
  writtenContracts: string
  qualityControl: string
  retroactiveYears: number
}

export function CreateQuotePage() {
  const { register, handleSubmit, watch, setValue } = useForm<FormValues>({
    defaultValues: {
      productCode: 'personal-auto',
      effectiveDate: new Date().toISOString().slice(0, 10),
      termMonths: 12,
      country: 'US',
      state: defaultRegionForCountry('US'),
      garagingZip: '10001',
      annualMiles: 12000,
      driverAge: 30,
      address: '1 Main St, Anytown',
      construction: 'frame',
      roofAgeYears: 10,
      caBusinessName: 'Acme Plumbing LLC',
      caGaragingZip: '10001',
      caVehicleCount: 3,
      caDriverCount: 4,
      caUseClass: 'artisan-contractor',
      caRadiusClass: 'local',
      caVehicleType: 'service-van',
      caGvwClass: 'light',
      caAnnualMileage: 18000,
      caYearsInBusiness: 7,
      caPriorLossesCount: 0,
      industry: 'technology',
      annualRevenue: 1000000,
      employeeCount: 50,
      recordsCount: 50000,
      mfaEnabled: 'true',
      backups: 'daily',
      priorIncidents: 0,
      publicFacingApps: 2,
      domain: 'example.com',
      plIndustry: 'consulting',
      plAnnualRevenue: 1000000,
      plEmployeeCount: 10,
      yearsInBusiness: 5,
      priorClaimsCount: 0,
      largestContractValue: 150000,
      subcontractorPct: 10,
      writtenContracts: 'true',
      qualityControl: 'standard',
      retroactiveYears: 3,
    }
  })

  const productCode = watch('productCode')
  const country = watch('country')
  const state = watch('state')

  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<any | null>(null)
  const navigate = useNavigate()

  const createQuoteMutation = useCreateQuoteMutation()
  const bindQuoteMutation = useBindQuoteMutation()
  const loading = createQuoteMutation.isPending || bindQuoteMutation.isPending

  const onSubmit = handleSubmit(async (data) => {
    setError(null)
    try {
      const payload: any = {
        productCode: data.productCode,
        effectiveDate: data.effectiveDate,
        termMonths: data.termMonths,
        country: data.country,
        state: data.state,
        applicant: { firstName: 'Test', lastName: 'User' },
        uwAnswers:
          data.productCode === 'personal-auto'
            ? { driverAge: data.driverAge }
            : data.productCode === 'commercial-auto'
              ? { vehicleCount: data.caVehicleCount, driverCount: data.caDriverCount, priorLossesCount: data.caPriorLossesCount }
              : data.productCode === 'professional-liability'
                ? { priorClaimsCount: data.priorClaimsCount, writtenContracts: data.writtenContracts === 'true', qualityControl: data.qualityControl }
                : {},
        risks: data.productCode === 'personal-auto'
          ? [{ type: 'autoVehicle', year: 2018, make: 'Toyota', model: 'Camry', garagingZip: data.garagingZip, usage: 'commute', annualMiles: data.annualMiles }]
          : data.productCode === 'commercial-auto'
            ? [{
                type: 'commercialAutoFleet',
                businessName: data.caBusinessName,
                garagingZip: data.caGaragingZip,
                vehicleCount: data.caVehicleCount,
                driverCount: data.caDriverCount,
                useClass: data.caUseClass,
                radiusClass: data.caRadiusClass,
                vehicleType: data.caVehicleType,
                gvwClass: data.caGvwClass,
                annualMileage: data.caAnnualMileage,
                yearsInBusiness: data.caYearsInBusiness,
                priorLossesCount: data.caPriorLossesCount
              }]
            : data.productCode === 'homeowners'
              ? [{ type: 'dwelling', address: data.address, construction: data.construction, yearBuilt: 2000, roofAgeYears: data.roofAgeYears }]
              : data.productCode === 'cyber'
                ? [{ type: 'cyberProfile', industry: data.industry, annualRevenue: data.annualRevenue, employeeCount: data.employeeCount, recordsCount: data.recordsCount, mfaEnabled: data.mfaEnabled, endpointProtection: 'true', backups: data.backups, priorIncidents: data.priorIncidents, publicFacingApps: data.publicFacingApps, domain: data.domain }]
                : [{
                    type: 'professionalLiabilityProfile',
                    industry: data.plIndustry,
                    annualRevenue: data.plAnnualRevenue,
                    employeeCount: data.plEmployeeCount,
                    yearsInBusiness: data.yearsInBusiness,
                    priorClaimsCount: data.priorClaimsCount,
                    largestContractValue: data.largestContractValue,
                    subcontractorPct: data.subcontractorPct,
                    writtenContracts: data.writtenContracts,
                    qualityControl: data.qualityControl,
                    retroactiveYears: data.retroactiveYears
                  }],
        coverages: []
      }
      const q = await createQuoteMutation.mutateAsync(payload)
      setQuote(q)
    } catch (err: any) {
      setError(err.message || String(err))
    }
  })

  const onBind = async () => {
    if (!quote?.quoteId) return
    try {
      const res = await bindQuoteMutation.mutateAsync(quote.quoteId)
      navigate(`/policies/${res.policyId}`)
    } catch (err: any) {
      setError(err.message || String(err))
    }
  }

  return (
    <div className="card">
      <h2>Create Quote</h2>
      <form onSubmit={onSubmit}>
        <div className="row">
          <div className="col">
            <label>Effective Date</label>
            <input type="date" {...register('effectiveDate')} />
          </div>
          <div className="col">
            <label>Country</label>
            <select
              {...register('country')}
              onChange={e => {
                const nextCountry = normalizeCountryCode(e.target.value)
                const nextRegion = isRegionInCountry(state, nextCountry)
                  ? normalizeRegionCode(state)
                  : defaultRegionForCountry(nextCountry)
                setValue('country', nextCountry)
                setValue('state', nextRegion)
              }}
            >
              <option value="US">USA</option>
              <option value="CA">Canada</option>
            </select>
          </div>
          <div className="col">
            <label>State</label>
            <select {...register('state')}>
              {!regionsForCountry(country).some((item) => item.code === normalizeRegionCode(state)) && state && (
                <option value={normalizeRegionCode(state)}>{normalizeRegionCode(state)}</option>
              )}
              {regionsForCountry(country).map((item) => (
                <option key={item.code} value={item.code}>{item.code} - {item.name}</option>
              ))}
            </select>
          </div>
          <div className="col">
            <label>Product</label>
            <select {...register('productCode')}>
              <option value="personal-auto">Personal Auto</option>
              <option value="commercial-auto">Commercial Auto</option>
              <option value="homeowners">Homeowners</option>
              <option value="cyber">Cyber</option>
              <option value="professional-liability">Professional Liability</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div className="col">
            <label>Term</label>
            <select {...register('termMonths', { valueAsNumber: true })}>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
            </select>
          </div>
        </div>

        {productCode === 'personal-auto' && (
          <div className="row">
            <div className="col">
              <label>Garaging ZIP</label>
              <input {...register('garagingZip')} />
            </div>
            <div className="col">
              <label>Annual Miles</label>
              <input type="number" {...register('annualMiles', { valueAsNumber: true })} />
            </div>
            <div className="col">
              <label>Driver Age</label>
              <input type="number" {...register('driverAge', { valueAsNumber: true })} />
            </div>
          </div>
        )}

        {productCode === 'homeowners' && (
          <div className="row">
            <div className="col">
              <label>Address</label>
              <input {...register('address')} />
            </div>
            <div className="col">
              <label>Construction</label>
              <select {...register('construction')}>
                <option value="frame">Frame</option>
                <option value="masonry">Masonry</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="col">
              <label>Roof Age (years)</label>
              <input type="number" {...register('roofAgeYears', { valueAsNumber: true })} />
            </div>
          </div>
        )}

        {productCode === 'commercial-auto' && (
          <>
            <div className="row">
              <div className="col">
                <label>Business Name</label>
                <input {...register('caBusinessName')} />
              </div>
              <div className="col">
                <label>Primary Garaging ZIP</label>
                <input {...register('caGaragingZip')} />
              </div>
              <div className="col">
                <label>Vehicle Count</label>
                <input type="number" min={1} {...register('caVehicleCount', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Driver Count</label>
                <input type="number" min={1} {...register('caDriverCount', { valueAsNumber: true })} />
              </div>
            </div>
            <div className="row">
              <div className="col">
                <label>Use Class</label>
                <select {...register('caUseClass')}>
                  <option value="artisan-contractor">Artisan Contractor</option>
                  <option value="service">Service</option>
                  <option value="retail-delivery">Retail Delivery</option>
                  <option value="wholesale-distribution">Wholesale Distribution</option>
                  <option value="for-hire">For-Hire</option>
                  <option value="livery">Livery</option>
                  <option value="mixed-business">Mixed Business</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="col">
                <label>Operating Radius</label>
                <select {...register('caRadiusClass')}>
                  <option value="local">Local</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="long-haul">Long-Haul</option>
                </select>
              </div>
              <div className="col">
                <label>Vehicle Type</label>
                <select {...register('caVehicleType')}>
                  <option value="service-van">Service Van</option>
                  <option value="pickup">Pickup</option>
                  <option value="light-truck">Light Truck</option>
                  <option value="box-truck">Box Truck</option>
                  <option value="mixed-fleet">Mixed Fleet</option>
                  <option value="dump-truck">Dump Truck</option>
                  <option value="tractor-trailer">Tractor Trailer</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="col">
                <label>GVW Class</label>
                <select {...register('caGvwClass')}>
                  <option value="light">Light</option>
                  <option value="medium">Medium</option>
                  <option value="heavy">Heavy</option>
                </select>
              </div>
            </div>
            <div className="row">
              <div className="col">
                <label>Average Annual Mileage (per vehicle)</label>
                <input type="number" min={0} {...register('caAnnualMileage', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Years in Business</label>
                <input type="number" min={0} {...register('caYearsInBusiness', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Prior Auto Losses (3 Years)</label>
                <input type="number" min={0} {...register('caPriorLossesCount', { valueAsNumber: true })} />
              </div>
            </div>
          </>
        )}

        {productCode === 'cyber' && (
          <>
            <div className="row">
              <div className="col">
                <label>Industry</label>
                <select {...register('industry')}>
                  <option value="technology">Technology</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="finance">Finance</option>
                  <option value="retail">Retail</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="education">Education</option>
                  <option value="professional-services">Professional Services</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="col">
                <label>Annual Revenue (USD)</label>
                <input type="number" {...register('annualRevenue', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Employees</label>
                <input type="number" {...register('employeeCount', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Sensitive Records</label>
                <input type="number" {...register('recordsCount', { valueAsNumber: true })} />
              </div>
            </div>
            <div className="row">
              <div className="col">
                <label>MFA Enabled</label>
                <select {...register('mfaEnabled')}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div className="col">
                <label>Backup Frequency</label>
                <select {...register('backups')}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div className="col">
                <label>Prior Incidents (3 years)</label>
                <input type="number" {...register('priorIncidents', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Public-Facing Apps</label>
                <input type="number" {...register('publicFacingApps', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Primary Domain</label>
                <input {...register('domain')} />
              </div>
            </div>
          </>
        )}

        {productCode === 'professional-liability' && (
          <>
            <div className="row">
              <div className="col">
                <label>Industry</label>
                <select {...register('plIndustry')}>
                  <option value="accounting">Accounting</option>
                  <option value="architecture-engineering">Architecture &amp; Engineering</option>
                  <option value="consulting">Consulting</option>
                  <option value="insurance-agency">Insurance Agency</option>
                  <option value="it-services">IT Services</option>
                  <option value="legal-services">Legal Services</option>
                  <option value="management-consulting">Management Consulting</option>
                  <option value="marketing-media">Marketing / Media</option>
                  <option value="real-estate">Real Estate Services</option>
                  <option value="staffing">Staffing</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="col">
                <label>Annual Revenue (USD)</label>
                <input type="number" {...register('plAnnualRevenue', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Employees</label>
                <input type="number" {...register('plEmployeeCount', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Years in Business</label>
                <input type="number" {...register('yearsInBusiness', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Prior Claims (5 years)</label>
                <input type="number" {...register('priorClaimsCount', { valueAsNumber: true })} />
              </div>
            </div>
            <div className="row">
              <div className="col">
                <label>Largest Contract Value (USD)</label>
                <input type="number" {...register('largestContractValue', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Subcontracted Work (%)</label>
                <input type="number" min={0} max={100} {...register('subcontractorPct', { valueAsNumber: true })} />
              </div>
              <div className="col">
                <label>Written Contracts Used</label>
                <select {...register('writtenContracts')}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div className="col">
                <label>Quality Control</label>
                <select {...register('qualityControl')}>
                  <option value="formal">Formal</option>
                  <option value="standard">Standard</option>
                  <option value="limited">Limited</option>
                </select>
              </div>
              <div className="col">
                <label>Prior Acts / Retro Years</label>
                <input type="number" {...register('retroactiveYears', { valueAsNumber: true })} />
              </div>
            </div>
          </>
        )}

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={loading}>Rate Quote</button>
        </div>

        {error && <p className="error">{error}</p>}
      </form>

      {quote && (
        <div style={{ marginTop: 16 }}>
          <h3>Quote Result</h3>
          <pre className="card" style={{ overflowX: 'auto' }}>{JSON.stringify(quote, null, 2)}</pre>
          <button onClick={onBind} disabled={loading}>Bind &amp; Issue</button>
        </div>
      )}

      <div className="muted" style={{ marginTop: 12 }}>
        Or view a policy: <Link to="/policies/demo">/policies/demo</Link>
      </div>
    </div>
  )
}
