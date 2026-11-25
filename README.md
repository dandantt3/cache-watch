# cache-watch

A Claude Code mod that adds a band above the prompt box showing whether your prompt cache is warm or cold:

- a countdown to when the cache goes cold (5 minutes or 1 hour, read from the last response)
- an estimate of what the next message costs to re-cache if it expires
- a toast before it goes cold (default 5 minutes before; capped at 20% of the lifetime)
- a **Keep warm** button that sends a tiny request to restart the clock

Dollar figures are estimates from a guessed per-model base input price. Set `inputUsdPerMTok` in the mod's config to your real rate.

## Install

At the prompt of a terminal session:

```
/plugin install cache-watch --marketplace <owner>/<repo>
```

From a shell:

```
claude plugin install cache-watch --marketplace <owner>/<repo>
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `<owner>/<repo>`, then Add plugin.

If the repository is private, you need read access on GitHub and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `ttl` | `auto` | `auto`, `5m` or `1h` |
| `warnMinutes` | `5` | minutes before cold to warn |
| `inputUsdPerMTok` | `0` | base input price override; 0 guesses from the model name |
