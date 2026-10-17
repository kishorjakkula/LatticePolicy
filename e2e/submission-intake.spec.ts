import { test, expect } from './support/fixtures'
import { apiJson, isoDate, uniqueName } from './support/api'

test('product changes replace qualification questions and require fresh confirmation', async ({ page, request, sessionFor, signInAs }) => {
  const { token } = await sessionFor('uw1')
  const submission = await apiJson<any>(request, 'POST', '/api/v1/submissions', {
    token, expectedStatus: 201,
    data: {
      productCode: 'homeowners',
      documents: [{
        fileName: 'application.txt',
        dataBase64: Buffer.from([
          'Applicant: ' + uniqueName('Intake Insured'),
          'State: TX',
          'Effective date: ' + isoDate(30),
          'No property claims in last 5 years?: yes',
        ].join('\n')).toString('base64'),
      }],
    },
  })
  await expect.poll(async () => (await apiJson<any>(request, 'GET', '/api/v1/submissions/' + submission.submissionId, { token })).status, { timeout: 30000 }).toBe('READY_FOR_REVIEW')
  await signInAs(page, 'uw1')
  await page.goto('/submissions/' + submission.submissionId)
  await expect(page.getByRole('combobox', { name: /No property claims in last 5 years/ })).toBeVisible()
  await page.getByRole('combobox', { name: /^Product/ }).selectOption('cyber')
  const mfa = page.getByRole('combobox', { name: /MFA enforced for all remote/ })
  await expect(mfa).toBeVisible()
  await expect(mfa).toHaveValue('')
  await expect(page.getByRole('combobox', { name: /No property claims in last 5 years/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Confirm MFA enforced/ })).toBeDisabled()
  const refreshed = await apiJson<any>(request, 'GET', '/api/v1/submissions/' + submission.submissionId, { token })
  const questions = refreshed.fields.filter((field: any) => field.key.startsWith('qual.'))
  expect(questions.length).toBeGreaterThan(0)
  expect(questions.every((field: any) => field.status === 'pending' && !field.value)).toBe(true)
  await apiJson(request, 'POST', '/api/v1/submissions/' + submission.submissionId + '/approve', {
    token, data: { attestation: true }, expectedStatus: 422,
  })
})
