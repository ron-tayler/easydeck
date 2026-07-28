import { shallowRef } from 'vue';

/**
 * Confirmation for the edits that destroy something.
 *
 * Promise-based so a caller reads as one line — `if (!(await confirmAction(…)))
 * return;` — rather than splitting every delete into a handler and a callback.
 *
 * Suppression is per *kind*, not global: ticking the box while deleting a
 * single button must not also disarm the warning for deleting a folder, which
 * takes every button inside it with it. Disarming the cheap confirmation
 * should never disarm the expensive one.
 *
 * Kept in module scope on purpose. It lives as long as the window's script
 * does, which is what "until the app restarts" means here — deliberately not
 * persisted, so a tick made in a hurry cannot follow someone into tomorrow.
 */
const suppressed = new Set<string>();

export interface ConfirmRequest {
  readonly kind: string;
  readonly title: string;
  readonly message: string;
  readonly resolve: (confirmed: boolean) => void;
}

export const pendingConfirm = shallowRef<ConfirmRequest | undefined>();

export function confirmAction(
  kind: string,
  title: string,
  message: string,
): Promise<boolean> {
  if (suppressed.has(kind)) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    pendingConfirm.value = { kind, title, message, resolve };
  });
}

/**
 * Answers the open request.
 *
 * The box is only honoured on a yes: someone who ticks it and then cancels has
 * said no to this deletion, which is a poor moment to conclude they want the
 * next one to happen silently.
 */
export function settleConfirm(confirmed: boolean, dontAskAgain = false): void {
  const request = pendingConfirm.value;
  pendingConfirm.value = undefined;
  if (!request) return;

  if (confirmed && dontAskAgain) suppressed.add(request.kind);
  request.resolve(confirmed);
}
