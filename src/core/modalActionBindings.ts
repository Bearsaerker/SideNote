import { SubmitExecutionGuard } from "./submitExecutionGuard";

export interface BindModalActionHandlersArgs {
    submitButton: EventTarget;
    cancelButton: EventTarget;
    submitGuard: SubmitExecutionGuard;
    onSubmitTriggered: () => void | Promise<void>;
    onCancelTriggered: () => void;
    onDebounceSuppressed?: (deltaMs: number) => void;
    now?: () => number;
}

export function bindModalActionHandlers(args: BindModalActionHandlersArgs): void {
    const now = args.now || (() => Date.now());

    const handleCancel = () => {
        if (args.submitGuard.isSubmitting()) {
            return;
        }
        args.onCancelTriggered();
    };

    const handleSubmit = async () => {
        const triggerResult = args.submitGuard.tryConsumeTrigger(now());
        if (!triggerResult.accepted) {
            args.onDebounceSuppressed?.(triggerResult.deltaMs);
            return;
        }
        await args.onSubmitTriggered();
    };

    args.cancelButton.addEventListener("click", () => {
        handleCancel();
    }, false);

    args.cancelButton.addEventListener("touchstart", (event: Event) => {
        event.preventDefault();
    }, false);

    args.cancelButton.addEventListener("touchend", (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        handleCancel();
    }, false);

    args.submitButton.addEventListener("click", () => {
        void handleSubmit();
    }, false);

    args.submitButton.addEventListener("touchstart", (event: Event) => {
        event.preventDefault();
    }, false);

    args.submitButton.addEventListener("touchend", (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleSubmit();
    }, false);
}
