import { describe, expect, it } from 'vitest'
import { calculateBackoffSeconds } from '../jobQueue.js'

describe('calculateBackoffSeconds', () => {
  it('grows exponentially with attempt number', () => {
    expect(calculateBackoffSeconds(1, 10, 600)).toBe(10)
    expect(calculateBackoffSeconds(2, 10, 600)).toBe(20)
    expect(calculateBackoffSeconds(3, 10, 600)).toBe(40)
    expect(calculateBackoffSeconds(4, 10, 600)).toBe(80)
  })

  it('caps the delay at maxSeconds', () => {
    expect(calculateBackoffSeconds(20, 10, 600)).toBe(600)
  })

  it('treats attempt numbers below 1 as the first attempt', () => {
    expect(calculateBackoffSeconds(0, 10, 600)).toBe(10)
    expect(calculateBackoffSeconds(-3, 10, 600)).toBe(10)
  })
})
