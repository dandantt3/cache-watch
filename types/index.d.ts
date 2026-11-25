export type CacheState = {
  /** ms epoch of the last API response (0 = none yet this session) */
  lastAt: number
  /** input-side tokens the next request re-sends */
  tokens: number
  /** model id that last answered */
  model: string
  /** 1-hour entry seen on the last response */
  is1h: boolean
  /** ms epoch, refreshed by the ticker so the band redraws */
  now: number
  /** the warning for the current lastAt was already shown */
  isWarned: boolean
  /** a keep-warm call is in flight */
  isKeeping: boolean
  /** short note after a keep-warm */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'cache-watch': { cache: CacheState }
  }
}
