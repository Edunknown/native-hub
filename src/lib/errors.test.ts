import { describe, expect, it } from 'vitest'
import { errorText, explainError } from './errors'

describe('explainError', () => {
  it.each([
    ['red: io: Connection refused (os error 10061)', 'Could not reach the server.'],
    ['network: dns failed to lookup address', 'Could not reach the server.'],
    ['GitHub does not accept the token (HTTP 403) api.github.com rate limit exceeded', 'GitHub is limiting requests for now.'],
    ['SHA-256 mismatch: expected abc, got def', 'The downloaded file does not match the published one.'],
    ['could not write: There is not enough space on the disk. (os error 112)', 'The disk is full.'],
    ['The process cannot access the file because it is being used by another process. (os error 32)', 'Another program is using the file.'],
    ['cannot create the games folder: Access is denied. (os error 5)', 'Windows does not allow writing to that folder.'],
    ['could not open C:\\Games\\soh.exe: The system cannot find the file specified. (os error 2)', 'A file or folder is missing.'],
    ['host not allowed: evil.example.com', 'NATIVE HUB does not download from that site.'],
    ['invalid catalog: only 3 projects', 'The downloaded catalog is not valid and was discarded.'],
  ])('%s', (raw, title) => {
    expect(explainError(raw)?.title).toBe(title)
  })

  it('does not match unrelated numbers', () => {
    expect(explainError('installation 52 not found')).toBeNull()
    expect(explainError('could not open: os error 50')).toBeNull()
  })

  it('every explanation with a hint says what to do', () => {
    const ex = explainError('os error 112')
    expect(ex?.hint).toMatch(/Settings/)
  })
})

describe('errorText', () => {
  it('keeps strings and unwraps errors', () => {
    expect(errorText('plain')).toBe('plain')
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText({ code: 1 })).toBe('{"code":1}')
  })
})
