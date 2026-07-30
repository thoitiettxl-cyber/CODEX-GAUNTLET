#!/usr/bin/env python3
"""Internal security pipeline component. It is not a pass/fail authority.

Only qa/verify.ps1 may invoke this component in repository workflows.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from gauntlet.security.run import main

if __name__ == "__main__":
    raise SystemExit(main())
