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

/**
 * What came back from the dialog.
 *
 * Three answers rather than two, because some of these are questions and not
 * warnings: a key dropped on an occupied one can be replaced *or* traded with,
 * and both are things somebody might mean.
 */
export type ConfirmAnswer = 'confirm' | 'alternative' | 'cancel';

export interface ConfirmRequest {
  readonly kind: string;
  readonly title: string;
  readonly message: string;
  /**
   * What the dangerous button says, when "Delete" is not what happens.
   *
   * Most of these confirmations are deletions and the word is the same every
   * time; dropping a preset over a configured key destroys it just as surely
   * but is called replacing, and a dialog whose button says the wrong verb is
   * a dialog people stop reading.
   */
  readonly confirmLabel?: string;
  /** The second way out, when there is one that destroys nothing. */
  readonly alternativeLabel?: string;
  readonly resolve: (answer: ConfirmAnswer) => void;
}

export const pendingConfirm = shallowRef<ConfirmRequest | undefined>();

export function confirmAction(
  kind: string,
  title: string,
  message: string,
  confirmLabel?: string,
): Promise<boolean> {
  if (suppressed.has(kind)) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    pendingConfirm.value = {
      kind,
      title,
      message,
      ...(confirmLabel === undefined ? {} : { confirmLabel }),
      resolve: (answer) => resolve(answer === 'confirm'),
    };
  });
}

/**
 * Asks which of two things to do, or neither.
 *
 * Never suppressed, unlike a warning: "do not ask again" answers a question
 * that has a safe default, and this one does not — whichever way it was last
 * answered, the next drop may well mean the other.
 */
export function chooseAction(
  kind: string,
  title: string,
  message: string,
  confirmLabel: string,
  alternativeLabel: string,
): Promise<ConfirmAnswer> {
  return new Promise<ConfirmAnswer>((resolve) => {
    pendingConfirm.value = { kind, title, message, confirmLabel, alternativeLabel, resolve };
  });
}

/**
 * Answers the open request.
 *
 * The box is only honoured on a yes: someone who ticks it and then cancels has
 * said no to this deletion, which is a poor moment to conclude they want the
 * next one to happen silently.
 */
export function settleConfirm(answer: ConfirmAnswer, dontAskAgain = false): void {
  const request = pendingConfirm.value;
  pendingConfirm.value = undefined;
  if (!request) return;

  if (answer === 'confirm' && dontAskAgain) suppressed.add(request.kind);
  request.resolve(answer);
}
