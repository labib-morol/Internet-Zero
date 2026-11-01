# AGENTS.md
Project: INTRANET ZERO, a fictional-internet investigation engine and game.
Read docs/STATUS.md first, then docs/PLAN.md.
Rules:
- TypeScript strict. pnpm only. Node 22.
- Game logic lives only in packages/runtime. apps/server only adapts transport.
- Never execute player input. Never add child_process, eval, Function, vm, or outbound HTTP in runtime, services, terminal or mcp packages.
- Never serialize facts, proofs, answer hashes or locked artifacts to any client.
- Every change: pnpm build && pnpm test must pass. Update docs/STATUS.md.
- Skills live in .agents/skills. Use them.
- Fictional hosts use the world's own suffix and are resolved only by the in-game router.
