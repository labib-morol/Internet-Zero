# Security Policy

## Reporting a vulnerability

Email the maintainers via the contact on the repository front page, or open a GitHub
Security Advisory ("Report a vulnerability"). Please do not open public issues for
exploitable problems. You can expect an initial response within 7 days.

## Scope

The game simulates a fictional internet. In scope: anything that lets game content
escape the simulation — client code execution via world content, SSRF from the server,
cross-team data leakage, canon/answer leakage to clients, path traversal on assets,
auth bypass on sessions or the MCP endpoint.

Out of scope: the fictional "hacking" gameplay itself; reports about in-fiction
content; automated scanner noise without a concrete vector.

## Design invariants (each has a test, see docs/security/threat-model.md)

- No player input is ever executed on the host.
- Canonical truth, answer hashes and locked artifacts never leave the server.
- Fictional hosts resolve only through the in-game router; no request leaves the
  server because of a URL typed in the game.
