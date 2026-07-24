# Product truth

This repository is the Termux operating control plane. Its current contract is
defined in [`termux-control-plane.md`](termux-control-plane.md).

It does not declare a consumer application surface; `qa/project-commands.json`
therefore keeps `application_present: false`. Control-plane integrity is
verified directly by Gauntlet structural and policy checks.
