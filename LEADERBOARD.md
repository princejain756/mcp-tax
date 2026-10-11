# mcp-tax leaderboard

Measured with `mcp-tax` on real stdio connections, no API keys required.
Token counts are o200k approximations — directional, not exact.

## Official reference servers (`@modelcontextprotocol/server-*`)

| Server | Tools | ~Tokens |
|---|---|---|
| filesystem | 14 | 1,580 |
| everything | 13 | 1,141 |
| memory | 9 | 897 |
| sequential-thinking | 1 | 839 |
| fetch | 1 | 235 |
| time | 2 | 222 |

## Third-party servers measured on a real machine

| Server | Tools | ~Tokens |
|---|---|---|
| claude-code | 20 | 14,324 |
| chrome-devtools | 30 | 5,264 |
| blender | 9 | 3,526 |
| browsermcp | 12 | 821 |
| brave-search | 2 | 301 |

## Takeaways

- One chatty server can outweigh ten small ones. `claude-code`'s 14.3k tokens
  are nearly half of a typical multi-server setup.
- Official servers are lean — the heaviest (`filesystem`) is still under 2k.
- Description verbosity is the whole game: `fetch` does one thing in 235 tokens,
  `sequential-thinking` spends 839 on a single tool's instructions.
- On a 32k local-model window, ~8 mid-size servers already exceed the context.

Run `npx mcp-tax` on your own setup and open a PR to add your numbers.
