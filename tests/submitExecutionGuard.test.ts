import * as assert from "node:assert/strict";
import test from "node:test";
import { SubmitExecutionGuard } from "../src/core/submitExecutionGuard";

test("SubmitExecutionGuard suppresses rapid repeated submit triggers", () => {
    const guard = new SubmitExecutionGuard(400);

    const first = guard.tryConsumeTrigger(1000);
    const second = guard.tryConsumeTrigger(1200);
    const third = guard.tryConsumeTrigger(1500);

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(second.deltaMs, 200);
    assert.equal(third.accepted, true);
});

test("SubmitExecutionGuard enforces single in-flight submit", () => {
    const guard = new SubmitExecutionGuard(400);

    assert.equal(guard.tryStartSubmit(), true);
    assert.equal(guard.tryStartSubmit(), false);
    assert.equal(guard.isSubmitting(), true);

    guard.finishSubmit();

    assert.equal(guard.isSubmitting(), false);
    assert.equal(guard.tryStartSubmit(), true);
});
