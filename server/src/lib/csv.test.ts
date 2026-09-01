import { describe, it, expect } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('quotes fields with comma / quote / newline', () => {
    expect(toCsv([['a,b', 'he said "hi"', 'x\ny']])).toBe('"a,b","he said ""hi""","x\ny"')
  })

  it('leaves plain values and numbers untouched', () => {
    expect(toCsv([['name', 42, 'ok']])).toBe('name,42,ok')
  })

  it('neutralizes spreadsheet formula triggers on string cells (CSV injection)', () => {
    // =, +, @ and a leading - on a string are prefixed with a single quote.
    expect(toCsv([['=1+1', '+A1', '@cmd', '-SUM(A1)']])).toBe("'=1+1,'+A1,'@cmd,'-SUM(A1)")
  })

  it('does NOT prefix negative NUMBERS (only dangerous strings)', () => {
    expect(toCsv([[-5, 3.5]])).toBe('-5,3.5')
  })

  it('quotes AND guards a formula cell that also needs quoting', () => {
    expect(toCsv([['=1,2']])).toBe('"\'=1,2"')
  })

  it('joins rows with CRLF', () => {
    expect(toCsv([['a'], ['b']])).toBe('a\r\nb')
  })
})
