// Qualification (eligibility) questions per core product: asked on the quote
// wizard's qualification step and drafted by submission intake. Answers are
// stored in the quote payload as qualificationAnswers: { [key]: 'yes' | 'no' }.

export type QualificationAnswer = '' | 'yes' | 'no'
export type QualificationAnswers = Record<string, QualificationAnswer>
export type QualificationVisibilityCondition = {
  key: string
  answer: Exclude<QualificationAnswer, ''>
}
export type QualificationQuestion = {
  key: string
  label: string
  required?: boolean
  /** Asked only when another question has this answer. */
  showWhen?: QualificationVisibilityCondition
}

export const QUALIFICATION_QUESTIONS: Record<string, QualificationQuestion[]> = {
  'personal-auto': [
    { key: 'noMajorViolations3Years', label: 'No major traffic violations in last 3 years?', required: true },
    {
      key: 'majorViolationsOlderThan12Months',
      label: 'If there were violations, were they more than 12 months ago?',
      required: true,
      showWhen: { key: 'noMajorViolations3Years', answer: 'no' }
    },
    { key: 'noAtFaultAccidents3Years', label: 'No at-fault accidents in last 3 years?', required: true },
    {
      key: 'singleAtFaultAccidentOnly',
      label: 'If there were accidents, was there only one at-fault accident?',
      required: true,
      showWhen: { key: 'noAtFaultAccidents3Years', answer: 'no' }
    },
    { key: 'continuousInsurance6Months', label: 'Continuous auto insurance for last 6 months?', required: true },
    {
      key: 'coverageLapseUnder30Days',
      label: 'If coverage lapsed, was the lapse 30 days or less?',
      required: true,
      showWhen: { key: 'continuousInsurance6Months', answer: 'no' }
    },
    { key: 'noRideshareOrDeliveryUse', label: 'Vehicle not used for rideshare or delivery?', required: true },
    { key: 'garagedAtResidence', label: 'Vehicle is primarily garaged at residence?', required: true }
  ],
  'commercial-auto': [
    { key: 'validCommercialDriversLicensed', label: 'All listed/operators are properly licensed for vehicle classes operated?', required: true },
    { key: 'fleetMaintained', label: 'Vehicles are maintained on a documented preventive maintenance schedule?', required: true },
    { key: 'noHazmatHauling', label: 'No hazardous materials hauling or specialized hazardous operations?', required: true },
    { key: 'noMajorLosses3Years', label: 'No severe/fatality losses in the last 3 years?', required: true },
    { key: 'dotComplianceControls', label: 'DOT/compliance controls and driver file management are in place (if applicable)?', required: true }
  ],
  homeowners: [
    { key: 'noPropertyClaims5Years', label: 'No property claims in last 5 years?', required: true },
    { key: 'roofMaintained', label: 'Roof is in good condition with no active leaks?', required: true },
    { key: 'noBusinessOnPremises', label: 'No business operations on premises?', required: true },
    { key: 'noVacancyOver30Days', label: 'Home not vacant for more than 30 days?', required: true },
    { key: 'protectiveDevicesInstalled', label: 'Smoke/CO detectors and basic protection devices installed?', required: true }
  ],
  cyber: [
    { key: 'mfaRequiredForRemoteAccess', label: 'MFA enforced for all remote and privileged access?', required: true },
    { key: 'edrOnManagedEndpoints', label: 'EDR/anti-malware active on managed endpoints?', required: true },
    { key: 'immutableBackupsTested', label: 'Backups are immutable/offline and tested regularly?', required: true },
    { key: 'incidentResponsePlan', label: 'Incident response plan documented and tested annually?', required: true },
    { key: 'noMaterialCyberLoss3Years', label: 'No material cyber loss events in the last 3 years?', required: true }
  ],
  'professional-liability': [
    { key: 'licensedAndInGoodStanding', label: 'Required licenses/certifications are active and in good standing?', required: true },
    { key: 'writtenContractsForAllWork', label: 'Written contracts and scope definitions are used for all engagements?', required: true },
    { key: 'noKnownCircumstances', label: 'No known incidents/circumstances likely to lead to a claim?', required: true },
    { key: 'qaPeerReviewProcess', label: 'Formal QA/peer review or supervisory controls are in place?', required: true },
    { key: 'noMaterialDisciplinaryActions', label: 'No material disciplinary actions in the last 5 years?', required: true }
  ]
}

export function qualificationQuestionsFor(productCode: string): QualificationQuestion[] {
  return QUALIFICATION_QUESTIONS[productCode] || []
}
