# Purpose

Define security standards that prevent sensitive data exposure and reduce exploit risk across Unity development and delivery workflows.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Standard Description
This standard enforces secure coding, secure configuration, and secure collaboration practices for Unity and C# projects. It prioritizes proactive risk communication, least-privilege design, and strict protection of secrets in source control and runtime systems.

## Rules
- Never commit sensitive data, including keys, tokens, passwords, certificates, or private config values.
- Treat all client-side Unity code as observable and potentially tamperable.
- Keep authoritative game logic and trust boundaries server-side where applicable.
- Validate all external input and network payloads before use.
- Use secure transport and trusted SDK configuration for networked features.
- Minimize exposed attack surface in debug endpoints, dev menus, and cheat pathways.
- Use environment-specific configuration for secrets and operational values.
- Review third-party Unity packages and extensions for maintenance health and security posture.
- Surface security concerns to the user immediately when identified.
- Ensure security-impacting decisions are documented in design and plan artifacts.

## Validation Checklist
- Repository scan confirms no secrets or sensitive artifacts are introduced.
- Configuration handling reviewed for environment separation and secret safety.
- Networked flows reviewed for validation, auth boundaries, and tamper assumptions.
- Client-authoritative logic risks identified and mitigated where relevant.
- Third-party dependencies reviewed for support status and known risk indicators.
- Security-relevant changes are traceable in requirements/design/project-plan docs.
- User has been explicitly informed of discovered security concerns.

## Common Violations
- Committing `.env`, API keys, service credentials, or private certificates.
- Assuming Unity client code is a secure trust boundary.
- Accepting unvalidated payloads from network or external services.
- Leaving debug tools or backdoor flags enabled in release paths.
- Using unmaintained packages without risk acknowledgement.
- Deferring security discussions until after implementation is complete.

## Review Questions
- Does this change introduce or expose any sensitive data in source control or logs?
- What trust boundary assumptions are being made, and are they safe?
- Could a modified client abuse this feature, and what mitigations exist?
- Are dependencies actively maintained and appropriate for foreseeable support?
- Were security risks communicated to the user with clear impact and options?

---
