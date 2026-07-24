---
name: verify-suite
description: Run canonical repository verification
---

# Verify suite

Select the narrowest useful mode, then run the repository authority:

```bash
./qa/verify --mode targeted
```

Before completion, ensure the Stop gate or an explicit command has run mandatory verification. Report exact commands and outcomes. Never substitute a custom matrix for `qa/verify`.
