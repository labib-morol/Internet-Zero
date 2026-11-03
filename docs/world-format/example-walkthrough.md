# Contributing a world — example walkthrough

This directory holds the generated JSON Schema reference (see `README.md`).
The tutorial world under `worlds/tutorial/` is the canonical example: it
exercises every service (forge, mail, archive, terminal, forum), all three
gate kinds, reports, hints and the completion marker.

Quick compile against your changes:

```bash
pnpm --filter @iz/compiler build
node packages/compiler/dist/cli.js build worlds/my-first-case \
  --salt 0123456789abcdef0123456789abcdef --report dist/report.json
```

Zero errors means the bundle is playable: point the server's `WORLDS_DIR` at
the output folder and start a case.
