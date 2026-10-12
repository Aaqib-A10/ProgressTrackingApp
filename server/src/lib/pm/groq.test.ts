import { describe, it, expect } from 'vitest'
import { keepSegment, collapseRepeats } from './groq'

describe('keepSegment — drop what Whisper invented', () => {
  it('keeps clear speech', () => {
    expect(keepSegment({ text: 'The county pages go live on Friday.', no_speech_prob: 0.02, avg_logprob: -0.25, compression_ratio: 1.3 })).toBe(true)
  })
  it('drops likely non-speech, guesses and loops', () => {
    expect(keepSegment({ text: 'Papa, I do not have a chair.', no_speech_prob: 0.62, avg_logprob: -0.6 })).toBe(false)
    expect(keepSegment({ text: 'Start the engine.', no_speech_prob: 0.1, avg_logprob: -1.2 })).toBe(false)
    expect(keepSegment({ text: 'yes yes yes yes yes yes yes yes', no_speech_prob: 0.1, avg_logprob: -0.3, compression_ratio: 3.1 })).toBe(false)
    expect(keepSegment({ text: 'Thank you for watching!', no_speech_prob: 0.1, avg_logprob: -0.2 })).toBe(false)
    expect(keepSegment({ text: 'Okay.', no_speech_prob: 0.05, avg_logprob: -0.2 })).toBe(false)
    expect(keepSegment({ text: 'Anees there', no_speech_prob: 0.1, avg_logprob: -0.8 })).toBe(false)
  })
})

describe('collapseRepeats', () => {
  it('removes a sentence said back to back', () => {
    expect(collapseRepeats('Send the RFQ. Send the RFQ. Then call him.')).toBe('Send the RFQ. Then call him.')
  })
})

import { keepSegment as keep2, tooManyWords, whisperLanguage } from './groq'
describe('speech to text guards', () => {
  it('never lets Whisper guess the language', () => {
    expect(whisperLanguage('mixed')).toBe('ur')
    expect(whisperLanguage('ur')).toBe('ur')
    expect(whisperLanguage('en')).toBe('en')
  })
  it('drops music/noise words and impossible amounts of text', () => {
    expect(keep2({ text: 'موسیقی', no_speech_prob: 0.1, avg_logprob: -0.2 })).toBe(false)
    expect(keep2({ text: '[موسیقی]', no_speech_prob: 0.1, avg_logprob: -0.2 })).toBe(false)
    expect(keep2({ text: 'ویب سائٹ کا ڈیزائن فائنل ہے', no_speech_prob: 0.05, avg_logprob: -0.3 })).toBe(true)
    expect(tooManyWords('one two three four five six seven eight nine ten eleven', 1000)).toBe(true)
    expect(tooManyWords('website ka design final kar diya hai', 3000)).toBe(false)
  })
})
