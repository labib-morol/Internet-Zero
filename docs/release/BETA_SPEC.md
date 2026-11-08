# Tutorial-first Public Beta Release Spec

Date: 2026-11-09. Request: prepare a brief, executable production/UX plan for GLM-5.3 Flash, with an approximately five-hour execution window and a separate owner checklist.

## Product and scope

- INTRANET ZERO is a fictional-internet investigation game. A new player must be able to start without signup, understand the next action without spoilers, finish the tutorial, and return without losing progress.
- Ship a polished **tutorial-only public beta** first. Preserve the existing fictional desktop, services, typography and visual identity; this is refinement, not a redesign.
- Browser, terminal, notebook, evidence board, reports/hints and supported team flows must work together. Unfinished or disabled capabilities must not masquerade as usable features.
- Guest play is mandatory. Real GitHub OAuth is conditional on complete implementation and owner-supplied credentials; otherwise clearly disable it. Private NODE_17 content and competitive/held-out benchmark claims are excluded.
- Initial deployment is one application process/replica with managed Postgres and image-baked tutorial assets. No S3/R2 or multi-replica support claims until actually implemented and tested.

## Acceptance

- Required real-Postgres tests cannot silently skip. Fresh-checkout build, lint, typecheck, world compilation, package/headless tests and browser acceptance must have recorded outcomes.
- No cross-session cached case content, wrong-team live streams, lost acknowledged state, replay cursor loss or apparent logout that leaves the session usable.
- Cookie-based browser login/reload works without exposing HttpOnly credentials to JavaScript. Cookie mutation and WebSocket Origin validation, expiry/revocation and production HTTPS settings are explicit.
- Readiness failures return HTTP 503. Deployment instructions reproduce an image build, migration, boot and ready state.
- Desktop and compact/touch layouts remain usable; real keyboard traversal can complete the tutorial. Core flows have no serious/critical axe violations, readable contrast, visible focus and usable error/loading states.
- Notes persist visibly and privately; purchased hints remain available after reload; navigation cannot overwrite newer state with late responses; terminal output remains visible through opening/resizing/minimizing.
- Authenticated responses are not publicly cacheable. Facts, proofs, answer hashes and locked artifacts never leave approved server projections; existing security boundaries remain intact.
- External staging, backup/restore, real OAuth, public release and repository settings require owner acceptance. No destructive test targets production.

## Execution and safety

Use TypeScript strict and pnpm. Game logic remains in packages/runtime; server adapts transport only. Never execute player input or introduce banned execution/network primitives in runtime/services/terminal/mcp. Fictional hosts resolve only through the in-game router.

The recorded Node 24 approval in docs/DECISIONS.md D1 conflicts with AGENTS.md's Node 22 wording. Disclose the discrepancy; do not edit instructions or silently claim Node 22 compatibility. Current machine is Node 24.15.0 and pnpm 12.16.1.

Use available context/tokens generously for meaningful implementation, tests and independent review, not token exhaustion. Completion is determined by acceptance evidence. If time runs short, leave a resumable ledger and explicit blockers rather than lowering release standards.
