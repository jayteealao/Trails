# Solutions

- [AVD headless wall — no device-observable AC is verifiable in agent sessions](testing/avd-headless-wall.md) — classify runtime-evidence ACs at plan time; KVM emulator CI job retires the wall
- [MockK can't invoke suspend lambdas from stub answers](gotcha/mockk-suspend-lambda-ceiling.md) — use fakes not mocks for suspend-callback APIs; propagate tooling ceilings to sibling plans
- [Triage fixes must prove documented invariants still hold](process/triage-fix-invariant-regression.md) — regression-test the invariant before landing; never update a test to match in the same commit
