import { describe, it, expect } from 'vitest'
import { parseAddress } from './mail'

describe('mail addresses', () => {
  it('splits "Name <email>" for Mailtrap', () => {
    expect(parseAddress('PulseTrack <noreply@pulsetrack.online>')).toEqual({ name: 'PulseTrack', email: 'noreply@pulsetrack.online' })
    expect(parseAddress('"Metriq Team" <hi@pulsetrack.online>')).toEqual({ name: 'Metriq Team', email: 'hi@pulsetrack.online' })
    expect(parseAddress('noreply@pulsetrack.online')).toEqual({ email: 'noreply@pulsetrack.online' })
    expect(parseAddress('<noreply@pulsetrack.online>')).toEqual({ email: 'noreply@pulsetrack.online' })
  })
})
