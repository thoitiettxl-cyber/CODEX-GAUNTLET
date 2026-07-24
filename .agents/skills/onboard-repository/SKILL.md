---
name: onboard-repository
description: Brownfield repository onboarding
---

# Onboard repository

Run only when the user explicitly invokes `$onboard-repository`.

## Pass 1 — read-only

Inspect application surfaces, stack, architecture, product documentation, test entrypoints, commands, missing repository knowledge, and proposed decisions. Do not modify the repository. Return evidence-backed proposals.

## Pass 2 — approved application

Apply only the exact proposal items the user explicitly selected. Do not broaden scope. Run focused proof and `./qa/verify`.
