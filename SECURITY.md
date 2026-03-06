# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 5.3.x   | :white_check_mark: |
| 5.2.x   | :white_check_mark: |
| 5.1.x   | :x:                |
| < 5.1   | :x:                |

Only the latest two minor versions receive security patches. Upgrade to the latest release for full coverage.

## Reporting a Vulnerability

**Do not open a public issue.** Instead, use one of these channels:

1. **GitHub Security Advisories (preferred):** [Report a vulnerability](https://github.com/rishi-banerjee1/prompt-control-plane/security/advisories/new)
2. **Email:** hello@getpcp.site

### What to include

- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Impact assessment (what an attacker could achieve)
- Suggested fix (if any)

### Response timeline

| Stage | SLA |
|-------|-----|
| Acknowledgment | 48 hours |
| Triage & severity assessment | 5 business days |
| Fix for critical/high severity | 14 days |
| Fix for medium/low severity | 30 days |
| Public disclosure | After fix is released |

## Security Model

PCP is a **deterministic, offline prompt governance engine**. Its security model is designed around these principles:

### What PCP does NOT do
- **Zero LLM calls** — no prompts are sent to any external AI service
- **Zero telemetry** — no usage data, analytics, or crash reports are transmitted
- **Zero network calls** — the engine runs entirely offline (MCP stdio transport is local IPC)
- **No prompt logging by default** — raw prompts are never persisted unless explicitly opted in via `PROMPT_CONTROL_PLANE_LOG_PROMPTS=true`

### Data storage

All data is stored locally at `~/.prompt-control-plane/`:

| File | Contains | Sensitivity |
|------|----------|-------------|
| `config.json` | User preferences (mode, threshold, strictness) | Low |
| `usage.json` | Optimization counts and period tracking | Low |
| `stats.json` | Aggregated statistics (no prompt content) | Low |
| `license.json` | License key data (chmod 600 on POSIX) | Medium |
| `audit.log` | Hash-chained audit trail (no prompt content) | Medium |
| `custom-rules.json` | User-defined governance rules | Low |
| `sessions/` | Session state (contains compiled prompts) | High |

### Cryptographic controls

- **License validation:** Ed25519 asymmetric signatures (public key only in source, private key never in repo)
- **Audit trail integrity:** SHA-256 hash-chained JSONL — each entry's hash includes the previous entry's hash. Tampering with any entry breaks all subsequent hashes.
- **Config lock:** SHA-256 hashed passphrase protection for configuration changes
- **Custom rules hash:** Deterministic SHA-256 hash of rule definitions for reproducibility

### Input hardening

- **Null byte stripping** on all prompt inputs
- **Whitespace normalization** (capped at 2 consecutive newlines)
- **Session ID sanitization** (alphanumeric + hyphens only, path traversal prevention)
- **ReDoS protection** on custom rule patterns (nested quantifier rejection, 10K char input cap)
- **Path traversal prevention** in file-based storage

### Supply chain

- **3 runtime dependencies:** `@modelcontextprotocol/sdk`, `zod`, `fast-glob`
- **CI runs `npm audit`** on every push (moderate+ severity threshold)
- **Dependabot** enabled for automated dependency updates
- **No postinstall scripts** — the package runs no code during installation

## Security-Related Configuration

### Audit logging (opt-in)

```bash
pcp config --audit-log true
```

Enables append-only, hash-chained audit trail. Events logged: optimize, approve, delete, purge, configure, license_activate. **Never stores prompt content.**

### Policy enforcement

```bash
pcp config --policy-mode enforce --strictness strict
```

In enforce mode, prompts exceeding the risk threshold are blocked with exit code 3.

### Config locking

```bash
pcp config --lock true --lock-secret "your-passphrase"
```

Prevents configuration changes without the passphrase. The secret is stored as a SHA-256 hash — never in plaintext.

## Known Limitations

- **Session files may contain compiled prompts.** If prompt confidentiality is critical, use ephemeral mode (`pcp config --ephemeral true`) or regularly purge sessions (`pcp config --session-retention-days 7`).
- **License keys are base64url-encoded JSON** (not encrypted). They contain tier and expiry data but no PII. File permissions (chmod 600) provide OS-level access control.
- **Rate limiting is instance-scoped.** Multiple PCP instances on the same machine have independent rate limit counters.
