import * as assert from "node:assert/strict";
import test from "node:test";
import { bindModalActionHandlers } from "../src/core/modalActionBindings";
import { SubmitExecutionGuard } from "../src/core/submitExecutionGuard";

test("modal action bindings: click + touchend in same window submits once", () => {
    const submitButton = new EventTarget();
    const cancelButton = new EventTarget();
    const guard = new SubmitExecutionGuard(400);

    let now = 1000;
    let submitCalls = 0;
    let debounceSuppressions = 0;
    let lastSuppressedDelta = -1;

    bindModalActionHandlers({
        submitButton,
        cancelButton,
        submitGuard: guard,
        onSubmitTriggered: () => {
            submitCalls += 1;
        },
        onCancelTriggered: () => {
            // noop
        },
        onDebounceSuppressed: (deltaMs) => {
            debounceSuppressions += 1;
            lastSuppressedDelta = deltaMs;
        },
        now: () => now,
    });

    submitButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    submitButton.dispatchEvent(new Event("touchend", { bubbles: true, cancelable: true }));

    assert.equal(submitCalls, 1);
    assert.equal(debounceSuppressions, 1);
    assert.equal(lastSuppressedDelta, 0);
});

test("modal action bindings: cancel is blocked while submit is in-flight", () => {
    const submitButton = new EventTarget();
    const cancelButton = new EventTarget();
    const guard = new SubmitExecutionGuard(400);

    let cancelCalls = 0;

    bindModalActionHandlers({
        submitButton,
        cancelButton,
        submitGuard: guard,
        onSubmitTriggered: () => {
            // noop
        },
        onCancelTriggered: () => {
            cancelCalls += 1;
        },
    });

    guard.tryStartSubmit();
    cancelButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    assert.equal(cancelCalls, 0);

    guard.finishSubmit();
    cancelButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    assert.equal(cancelCalls, 1);
});

test("modal action bindings: submits again after debounce window", () => {
    const submitButton = new EventTarget();
    const cancelButton = new EventTarget();
    const guard = new SubmitExecutionGuard(400);

    let now = 1000;
    let submitCalls = 0;

    bindModalActionHandlers({
        submitButton,
        cancelButton,
        submitGuard: guard,
        onSubmitTriggered: () => {
            submitCalls += 1;
        },
        onCancelTriggered: () => {
            // noop
        },
        now: () => now,
    });

    submitButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    now = 1501;
    submitButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    assert.equal(submitCalls, 2);
});
