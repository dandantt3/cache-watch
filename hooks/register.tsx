import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { CacheState } from '../types'

const initial: CacheState = {
  lastAt: 0,
  tokens: 0,
  model: '',
  is1h: false,
  now: 0,
  isWarned: false,
  isKeeping: false,
  note: '',
}

const cache = atom({ plugin: 'cache-watch', key: 'cache' } as const, initial)

const MIN = 60_000

const basePrice = (model: string): number => {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 5
  if (m.includes('haiku')) return 1
  return 3
}

const usd = (n: number): string => (n < 0.01 ? '<$0.01' : `$${n.toFixed(n < 1 ? 3 : 2)}`)

const clock = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

/** A response just came back: the cache clock restarts. */
async function touch($: Engine, patch: Partial<CacheState>): Promise<void> {
  const now = await $.clock.now()
  await update($, cache, s => ({ ...s, ...patch, lastAt: now, now, isWarned: false, note: '' }))
}

async function keepWarm($: Engine): Promise<void> {
  await update($, cache, s => ({ ...s, isKeeping: true, note: '' }))
  try {
    const r = await $.model.fork({
      prompt: 'Cache keep-alive ping. Use no tools and no thinking. Reply with the single word: ok',
    })
    if ('usage' in r && r.usage) {
      const rd = r.usage.cache_read_input_tokens
      const wr = r.usage.cache_creation_input_tokens
      const now = await $.clock.now()
      await update($, cache, s => ({
        ...s,
        lastAt: now,
        now,
        isWarned: false,
        isKeeping: false,
        note: wr > rd ? 'Was cold: re-cached' : 'Kept warm',
      }))
    } else {
      await update($, cache, s => ({ ...s, isKeeping: false, note: 'Nothing to keep warm yet' }))
    }
  } catch {
    await update($, cache, s => ({ ...s, isKeeping: false, note: 'Keep-warm failed' }))
  }
}

export const register: Register = (on, options) => {
  const opt = options as unknown as { ttl?: string; warnMinutes?: number; inputUsdPerMTok?: number }

  const ttlMs = (s: CacheState): number => {
    const mode = opt.ttl ?? 'auto'
    const is1h = mode === '1h' || (mode === 'auto' && s.is1h)
    return is1h ? 60 * MIN : 5 * MIN
  }

  const warnLeadMs = (s: CacheState): number =>
    Math.min((opt.warnMinutes ?? 5) * MIN, ttlMs(s) * 0.2)

  const prices = (s: CacheState) => {
    const base = opt.inputUsdPerMTok && opt.inputUsdPerMTok > 0 ? opt.inputUsdPerMTok : basePrice(s.model)
    const writeMult = ttlMs(s) > 5 * MIN ? 2 : 1.25
    return { write: (s.tokens / 1e6) * base * writeMult, read: (s.tokens / 1e6) * base * 0.1 }
  }

  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, cache, s => ({ ...s, now }))

    $.clock.every(15_000, async () => {
      const t = await $.clock.now()
      const s = await read($, cache)
      await update($, cache, c => ({ ...c, now: t }))

      if (s.lastAt > 0 && !s.isWarned && !s.isKeeping) {
        const left = ttlMs(s) - (t - s.lastAt)
        if (left > 0 && left <= warnLeadMs(s)) {
          await update($, cache, c => ({ ...c, isWarned: true }))
          const p = prices(s)
          $.ui.toast(
            `Prompt cache goes cold in ${clock(left)}. Re-caching ~${usd(p.write)}. Press "Keep warm" above the prompt.`,
            { timeoutMs: 10_000 },
          )
        }
      }
    })

    return next(e)
  })

  // Every response (also mid-turn tool loops) refreshes the cache entry.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    await touch($, {})
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const tokens = (await $.session.usage()).context.tokens ?? 0
    const u = e.usage
    await touch($, {
      ...(tokens ? { tokens } : {}),
      ...(u ? { model: u.model, is1h: (u.ephemeral_1h_input_tokens ?? 0) > 0 } : {}),
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const tokens = e.context.tokens
    if (tokens) await update($, cache, s => ({ ...s, tokens }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, cache)
    if (e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)

    if (s.lastAt === 0) {
      return (
        <Box>
          <Text dimColor>Cache: no response seen since the mod loaded; it starts tracking after your next reply</Text>
        </Box>
      )
    }
    const left = ttlMs(s) - (s.now - s.lastAt)
    const p = prices(s)
    const tok = s.tokens ? `${Math.round(s.tokens / 1000)}k tokens` : 'context size unknown'
    const ttlLabel = ttlMs(s) > 5 * MIN ? '1h' : '5m'

    if (s.isKeeping) {
      return (
        <Box>
          <Text color="yellow">Cache: refreshing…</Text>
        </Box>
      )
    }

    if (left <= 0) {
      return (
        <Box>
          <Text color="red">
            Cache COLD ({ttlLabel} TTL) · next message re-caches {tok} ≈ {usd(p.write)} (warm read would be {usd(p.read)}){' '}
          </Text>
          <Button key="keep" label="Re-warm now" onPress={() => keepWarm($)} />
          {s.note ? <Text dimColor> {s.note}</Text> : null}
        </Box>
      )
    }

    const isSoon = left <= warnLeadMs(s)
    return (
      <Box>
        <Text color={isSoon ? 'yellow' : 'green'}>
          Cache {isSoon ? 'COOLING' : 'warm'} · {clock(left)} left ({ttlLabel}) · {tok} · expires: ≈ {usd(p.write)} · keep warm: ≈ {usd(p.read)} (est.){' '}
        </Text>
        <Button key="keep" label="Keep warm" onPress={() => keepWarm($)} />
        {s.note ? <Text dimColor> {s.note}</Text> : null}
      </Box>
    )
  })
}
