Preserve only the bounded recovery context needed to continue this repository
task safely:

1. The exact Harness story ID and linked Git execution-plan path.
2. The current outcome, constraints, and authority boundaries.
3. Completed operations versus pending operations.
4. The last explicitly recorded safe boundary.
5. Stable external-operation identifiers and observed target state, never raw
   credentials, prompts, transcripts, or tool payloads.
6. Verification already observed and verification still required. Never turn
   metadata into a pass claim.
7. One exact next action.

If story selection is ambiguous, say so and require explicit binding. If an
external operation has unknown outcome, require inspection of both the
operation ledger and real target before any retry. Keep Harness lifecycle, the
Git plan, target-system state, and `qa/verify.ps1` in their existing authority
roles.
