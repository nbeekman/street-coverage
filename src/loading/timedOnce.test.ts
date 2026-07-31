import { describe, expect, it } from 'vitest'
import { timedOnce } from './timedOnce.ts'

describe('timedOnce', () => {
  it('runs the load once and shares the result', async () => {
    let calls = 0
    const load = timedOnce(async () => {
      calls++
      return { payload: 'geometry' }
    })

    const first = await load()
    const second = await load()

    expect(calls).toBe(1)
    // Identity, not just equality: deck.gl compares props by reference, and a
    // fresh object per call re-uploads every vertex to the GPU.
    expect(second.value).toBe(first.value)
  })

  it('shares one load between callers that overlap', async () => {
    let calls = 0
    const load = timedOnce(async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 1))
      return calls
    })

    const [a, b] = await Promise.all([load(), load()])

    expect(calls).toBe(1)
    expect(a.value).toBe(b.value)
  })

  it('reports the first load\'s duration to later callers', async () => {
    const load = timedOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return 'done'
    })

    const first = await load()
    const second = await load()

    // A cache hit costs nothing; reporting that as the decode time would
    // misdescribe what the load actually cost.
    expect(second.decodeMs).toBe(first.decodeMs)
    expect(first.decodeMs).toBeGreaterThan(0)
  })

  it('does not cache a rejection', async () => {
    let calls = 0
    const load = timedOnce(async () => {
      calls++
      if (calls === 1) throw new Error('network died')
      return 'recovered'
    })

    await expect(load()).rejects.toThrow('network died')
    await expect(load()).resolves.toMatchObject({ value: 'recovered' })
  })

  it('passes the first caller\'s arguments through', async () => {
    const seen: string[] = []
    const load = timedOnce(async (which: string) => {
      seen.push(which)
      return which
    })

    await load('first')
    await load('second')

    // Later callers get the cached load, so their arguments are irrelevant.
    expect(seen).toEqual(['first'])
  })
})
