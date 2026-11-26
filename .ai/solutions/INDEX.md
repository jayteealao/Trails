# Solutions

- [AVD headless wall — no device-observable AC is verifiable in agent sessions](testing/avd-headless-wall.md) — classify runtime-evidence ACs at plan time; KVM emulator CI job retires the wall
- [MockK can't invoke suspend lambdas from stub answers](gotcha/mockk-suspend-lambda-ceiling.md) — use fakes not mocks for suspend-callback APIs; propagate tooling ceilings to sibling plans
- [Triage fixes must prove documented invariants still hold](process/triage-fix-invariant-regression.md) — regression-test the invariant before landing; never update a test to match in the same commit
- [A stale versionName passes every gate but cannot ship](build-tooling/version-tag-collision.md) — check versionName against existing git tags before merge/tag; every pre-ship gate is blind to a taken version
- [Dependency-bump freshness must check bytecode target + CVEs on the exact shipped versions](build-tooling/freshness-bytecode-and-cve-blindspot.md) — "toolchain-compatible" ≠ "will link" ≠ "no CVE"; chucker Java-21-vs-17 + a CVSS 9.8 supply-chain miss came from one gap
- [Runtime-evidence walls: pressure-test the cheapest proxy before deferring](testing/runtime-evidence-wall-cheapest-proxy.md) — guest/anonymous auth crossed an "interactive-auth-blocked" wall with no credential; probing a deferral is where latent bugs get found
- [Always-remote bindings make wrangler/cf dev need a Cloudflare token](gotcha/remote-binding-dev-needs-token.md) — start any test/CI server of a Worker with Workers AI or Browser Rendering bindings with `--local`; verify with the token unset
- [Reader changes need real legacy archives, not synthetic fixtures](testing/legacy-archive-fixtures-over-synthetic.md) — sample stored archives of every pipeline age before ranking/parsing rules; all 4 HIGH findings came from the phone
- [GitHub refuses rebase-merge of a branch with merge commits](gotcha/rebase-merge-refused-with-merge-commits.md) — check `git rev-list --merges` before offering rebase; fast-forward main as the fallback
- [A clearing probe must test the deployment](process/clearing-probe-tests-the-deployment.md) — origin/main is a proxy and an unauthenticated wrangler is not a "not yet"; four of six packets missed an event that had happened
- [A retired secret needs an owner](process/retired-secret-needs-an-owner.md) — a deploy does not remove a secret; put add and remove steps in person-tasks with their preconditions
- [A Workflow instance is its own trace](gotcha/workflow-instance-is-its-own-trace.md) — never promise one trace per archive; join by instance id
