# Security Policy

## Supported versions

Next Quest Manager is pre-1.0. Security fixes land on the default branch
(`main`), and self-hosters are encouraged to track it. Older tags are not
patched.

| Version | Supported |
| ------- | --------- |
| `main` / latest release | ✅ |
| anything older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately through GitHub Security Advisories:

1. Go to <https://github.com/BadWolfDev/next-quest-manager/security/advisories/new>
2. Describe the issue, the impact, and how to reproduce it.

If you can, include the affected version or commit, whether it needs an
authenticated account, and what an attacker gains.

We aim to acknowledge within a few days and to ship a fix before any public
disclosure. We're happy to credit you in the advisory — say so if you'd like
that, or if you'd rather stay anonymous.

## Scope

In scope: authentication and session handling, the workspace authorization model
(roles, invites, membership), the MCP endpoint and personal access tokens,
injection of any kind, and anything that lets one user read or change another
user's data.

Out of scope: findings that require an attacker to already control the server or
the database, missing hardening headers on a self-hosted deployment you've
configured yourself, and rate-limit thresholds you consider too generous (open a
normal issue for those).
