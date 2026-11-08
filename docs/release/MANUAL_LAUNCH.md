# Manual Launch Checklist — INTRANET ZERO

Recommended release: tutorial-only public beta. Engine improvements can proceed without a hosting account, OAuth credentials or private NODE_17 content. **Do not deploy solely because an agent says the plan is done; read its release report.**

## 1. Before starting GLM — do these now

1. In ZCode, select **GLM-5.3 Flash** yourself. This plan has not switched models or started implementation. Keep this workspace open.
2. Start **Docker Desktop**, wait for the Linux engine to show running, then run `docker info` in your terminal. This planning session got `dockerDesktopLinuxEngine ... The system cannot find the file specified`. If Docker cannot run, provide a **disposable test Postgres** connection instead; never a production DB. GLM must first fix the hardcoded test credentials and silent-skip behavior.
3. Keep a terminal/session available for approval prompts. Authorize safe local edits/tests through your normal permission mode. Production migrations, deployments, external model calls, paid services, publishing and git push remain separate decisions. Do not enable a blanket bypass for secrets or destructive actions.
4. Node is 24.15.0, pnpm 12.16.1. `docs/DECISIONS.md` D1 already records Node 24 approval, but AGENTS still says 22. Confirm the intended supported version before changing instructions/CI; GLM must not silently change those instructions. Using current recorded Node 24 evidence does not prove Node 22 compatibility.
5. Paste the prompt below. The five hours starts from the provider's actual remaining window, not the dates or suggested estimates in this document.

### Copy-paste prompt for GLM

```text
Execute docs/superpowers/plans/2026-11-09-production-readiness.md using docs/release/BETA_SPEC.md as the scope and docs/release/MANUAL_LAUNCH.md for owner tasks. First read AGENTS.md, latest docs/STATUS.md and docs/PLAN.md. I want implementation now, not another generic plan. Use GLM-5.3 Flash in this session; do not switch providers/models.

I have approximately five hours of remaining access and ample token capacity. Use tokens generously for worthwhile implementation, regression tests, debugging, browser acceptance and independent review; do not sacrifice quality to conserve tokens. Do not consume tokens for their own sake, repeatedly re-investigate solved questions, rewrite the app, or create unrelated features. Fix verified release blockers first and preserve the fictional-desktop design. Tutorial-only public beta; no NODE_17/private world or unsupported competitive benchmark claims.

Create a feature branch, implement the six tasks in order, maintain docs/release/EXECUTION_LEDGER.md, and update docs/STATUS.md with actual results. Use the installed executing-plans, test-driven-development, systematic-debugging, verification-before-completion, security-audit and applicable UI/browser skills. Run pnpm build && pnpm test after every task. Required DB tests must execute against isolated Postgres, never silently skip. Do not weaken assertions or mark old/skipped evidence as a pass.

Continue safe local work without repeatedly asking what to do next. Do not commit unless I explicitly authorize commits, and ask before push/merge, publication/deployment, paid services, sending content to external AI/services, credential use beyond stated scope, or destructive/database operations outside disposable test infrastructure. Never change AGENTS.md or permission/security settings to bypass a blocker.

At 60 minutes remaining stop adding scope and verify. At 15 minutes remaining record exact progress, commands, failures, blockers and next action. If the planned work finishes early, use remaining useful time for meaningful edge-case tests, blind tutorial playtesting and verified accessibility/performance repairs. Stop when scoped acceptance is genuinely satisfied; do not invent more work just to use tokens.

Deliver docs/release/RELEASE_REPORT.md and a concise final reply: implemented changes; build/test/browser/security evidence with passed/failed/skipped counts; honest LOCAL CANDIDATE / STAGING ACCEPTED / NOT READY verdict; and exact steps I must do manually. Missing Docker, OAuth credentials, staging approval or other owner dependencies must remain explicit blockers, not fabricated success. Start with Task 1 now.
```

## 2. GitHub — after local acceptance

The repository is already on GitHub and STATUS records a green November 5 CI run. No need to recreate or republish it blindly.

1. Read `docs/release/RELEASE_REPORT.md`. Confirm required DB/browser checks actually ran, no blocker/major remains for enabled features, and reports are sanitized. Missing checks mean **NOT READY**.
2. Review changes and license/attribution, public support contact, security reporting instructions and updated README. Keep `.env`, private specs/answer keys, recovery codes and compiled private worlds out of tracked files/history/artifacts.
3. Authorize local commits and a feature-branch push/PR when satisfied. Do not ask GLM to push directly to `main` or bypass checks.
4. In GitHub **Settings → Rules/Rulesets or Branches**, protect `main`: require a PR and the corrected CI/security/browser checks; prohibit force pushes. Require independent review when available; for a solo repository, do not configure an impossible approval requirement that forces routine bypasses. Confirm exact check names after they exist.
5. In repository **Settings → Security**, enable available dependency/security alerts and private vulnerability reporting. Set a real contact you are willing to publish; no invented address.
6. Review/merge only after required checks and artifacts are satisfactory. Public beta announcement/tag is a separate owner decision.

## 3. Hosting — after the agent fixes the deployment files

Render is the existing documented hosting option, not a requirement to open a new account during coding.

1. Create/sign in to Render and approve the actual monthly Web Service + Postgres cost. Existing Blueprint uses paid tiers; this plan promises no pricing or free tier.
2. Authorize connection to this repository. Select Blueprint **`infra/render.yaml`**, with service Dockerfile explicitly **`./infra/Dockerfile`**; let GLM correct this first. Start with **one application process/replica**, not autoscaling.
3. Use staging or a disposable first-launch DB. Review migration commands before execution. Never run tests/outage experiments against a production DB.
4. Set secrets in the provider's secret environment, not chat, files checked into git, or issue bodies:
   - `DATABASE_URL`: bound managed Postgres connection.
   - `SESSION_SECRET`: cryptographically random value with at least 32 bytes of entropy. Generate locally, e.g. `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; paste only into secret storage. Do not rotate an existing deployment secret casually.
   - `PUBLIC_ORIGIN`: exact canonical `https://...` domain, no callback path.
   - `WORLDS_DIR=/app/dist/worlds`; `LOG_LEVEL=info` unless the corrected deployment says otherwise.
   - Any explicit proxy-trust setting introduced by GLM must match the actual Render/custom proxy topology. Never trust all arbitrary forwarding headers.
5. Deploy the reviewed candidate. Check image build, migration logs without secrets, `/healthz`, and `/readyz`. Readiness must be HTTP **200 when ready / 503 when not**, not just a JSON boolean.
6. On the HTTPS site, manually start a guest, save the recovery code privately, finish tutorial steps, reload, recover in a separate browser, save/reload notes, join a second account's team, disconnect/reconnect, and verify logout. If OAuth is disabled, it must look disabled rather than be a dead button.
7. Configure available uptime/error alerts and a backup policy; record your acceptable data-loss/recovery window. Perform a backup restore into a **separate disposable DB**, verify progress/event replay there, and leave production untouched. Obtain evidence of alert delivery and restore success; paying for Postgres alone does not prove backups are configured.
8. Only after staging acceptance, authorize production URL/domain activation. If changing domains, update `PUBLIC_ORIGIN`, OAuth callback and exact Origin/proxy policies together. Do not enable shared caching for authenticated API/WS content.

## 4. GitHub sign-in — optional, can ship guest-only first

Do this only after the agent completes cookie-only browser startup, WS authentication, logout and callback tests. A passing mocked OAuth test is not real sign-in acceptance.

1. GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Homepage URL: the exact intended public/staging origin.
3. Authorization callback: **`https://YOUR-DOMAIN/api/auth/github/callback`**.
4. Store the Client ID as `GITHUB_OAUTH_ID` and Client Secret as `GITHUB_OAUTH_SECRET` in Render secret settings. Do not paste the secret into this conversation. Prefer separate OAuth apps for staging and production.
5. Deploy/restart as appropriate, sign in from a browser with empty sessionStorage, reload, join a team and log out. Test cancellation/failure too. If any flow fails, disable the sign-in entry point until fixed; guest play should still work.

## 5. Not needed for this beta

- No private NODE_17 repo/content: tutorial-first beta is independent of it. Provide private material only through a separately authorized, isolated content process later.
- No paid model/API key for ordinary game use or scripted MCP tests. A real reference-agent run requires your separate provider/data/credit consent; defer unsupported claims otherwise.
- No R2/S3 account or extra analytics stack: current safe launch uses baked assets; do not set unused advertised storage credentials.

## Completion decision

Launch only with: corrected no-skip CI, passing fresh local/container/browser checks, verified identity/recovery/team flows, current security sign-off, honest documentation, staging persistence/HTTPS acceptance, backup/restore evidence, and your approval. Cosmetic polish cannot compensate for a wrong team, lost progress, unusable sign-in or false-green tests.
