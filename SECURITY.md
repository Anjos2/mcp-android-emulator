# Security Policy

## Reporting a Vulnerability

If you discover a security issue in `mcp-android-emulator`, please report it
privately to the maintainer via GitHub Security Advisories:

<https://github.com/Anjos2/mcp-android-emulator/security/advisories/new>

Please include:

- A description of the issue and its impact.
- Steps to reproduce, ideally without a weaponized payload.
- Affected tool(s), file(s), and line number(s) if known.
- Your preferred contact for follow-up.

We aim to acknowledge reports within **72 hours** and publish a fix within
**14 days** for critical issues when a remediation path is clear.

## Scope

The MCP server runs **with the privileges of the user that launched it**
(typically your Claude Code / Claude Desktop process). A vulnerability in
this package may allow code execution on the user's machine through any
LLM that is authorised to call its tools. Please treat that blast radius
when assessing severity.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | ✅         |
| 1.x     | ❌ (superseded by 2.0.0; please upgrade) |

## Disclosure Timeline

We follow a coordinated disclosure model:

1. Reporter submits advisory privately.
2. Maintainer acknowledges, triages, and proposes a timeline.
3. Fix is developed and tested on a private branch.
4. A release is published, followed by the advisory going public.
5. Reporter is credited unless they request otherwise.
