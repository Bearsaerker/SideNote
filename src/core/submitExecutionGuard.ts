export interface TriggerAttemptResult {
    accepted: boolean;
    deltaMs: number;
}

export class SubmitExecutionGuard {
    private submitting = false;
    private lastTriggerAt = 0;
    private readonly debounceMs: number;

    constructor(debounceMs: number) {
        this.debounceMs = debounceMs;
    }

    tryConsumeTrigger(now: number): TriggerAttemptResult {
        const deltaMs = now - this.lastTriggerAt;

        if (this.lastTriggerAt !== 0 && deltaMs < this.debounceMs) {
            return { accepted: false, deltaMs };
        }

        this.lastTriggerAt = now;
        return { accepted: true, deltaMs };
    }

    tryStartSubmit(): boolean {
        if (this.submitting) {
            return false;
        }
        this.submitting = true;
        return true;
    }

    finishSubmit(): void {
        this.submitting = false;
    }

    isSubmitting(): boolean {
        return this.submitting;
    }

    reset(): void {
        this.submitting = false;
        this.lastTriggerAt = 0;
    }
}
