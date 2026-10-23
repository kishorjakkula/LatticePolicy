import request from 'supertest'
import { expect, it } from 'vitest'
import { createApp } from '../app.js'

const app = createApp()
const paths = ['/api/v1/addresses/check', '/api/v1/addresses/check/', '/API/V1/ADDRESSES/CHECK']
const marker = 'SYNTHETIC_PRIVATE_MARKER'

it.each(paths)('sanitizes malformed address JSON before authentication at %s', async path => {
  const response = await request(app).post(path).set('Content-Type', 'application/json')
    .send(`{"address":"${marker}",`).expect(400)
  expect(response.body.code).toBe('INVALID_ADDRESS_INPUT')
  expect(response.text).not.toContain(marker)
  expect(response.body).not.toHaveProperty('stack')
})

it.each(paths)('enforces the small address body limit on %s', async path => {
  const response = await request(app).post(path).set('Content-Type', 'application/json')
    .send(JSON.stringify({ address: { line1: marker + 'x'.repeat(5000) } })).expect(413)
  expect(response.body.code).toBe('PAYLOAD_TOO_LARGE')
  expect(response.text).not.toContain(marker)
  expect(response.body).not.toHaveProperty('stack')
})
