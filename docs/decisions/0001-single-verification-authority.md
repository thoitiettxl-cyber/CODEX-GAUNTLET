# ADR 0001: Single verification authority

## Status

Accepted.

## Decision

`./qa/verify` is the sole repository definition-of-pass. Hooks, Harness metadata, skill workflows, and CI all delegate to it rather than implementing parallel pass/fail matrices.

## Consequences

Verification policy is centralized and auditable. Harness upgrades cannot silently redefine completion. CI remains the final authority for mergeability.
