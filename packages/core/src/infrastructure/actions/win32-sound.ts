import { KOFFI, loadCom } from './win32-com.js';

/**
 * The short sounds Windows already has, played by name.
 *
 * `PlaySoundW` with an alias asks Windows for whichever file the user has put
 * behind that event in their sound scheme, so a timer finishing sounds like
 * the rest of their machine rather than like this program. It also means no
 * audio file ships with EasyDeck, no decoder is needed, and somebody who has
 * silenced their notifications gets silence here too — which is the correct
 * behaviour and would have taken a setting to reproduce otherwise.
 *
 * Windows only. Elsewhere this does nothing rather than shelling out to
 * whichever player happens to be installed; a timer that beeps on one machine
 * and prints an error on another is worse than one that is simply quiet.
 */

/** Play without blocking, by alias, and stay silent if the alias is unknown. */
const SND_ASYNC = 0x0000_0001;
const SND_NODEFAULT = 0x0000_0002;
const SND_ALIAS = 0x0001_0000;

/**
 * The events worth offering, out of the forty a machine declares.
 *
 * Chosen for what a finished timer wants to sound like, and named by what they
 * are for rather than by their registry key. Every one of them is part of a
 * standard scheme; an event the user has set to "(None)" plays nothing, which
 * is their answer and not an error.
 */
export const SYSTEM_SOUNDS = [
  { alias: 'Notification.Reminder', en: 'Reminder', ru: 'Напоминание' },
  { alias: 'Notification.Default', en: 'Notification', ru: 'Уведомление' },
  { alias: 'Notification.Looping.Alarm', en: 'Alarm', ru: 'Будильник' },
  { alias: 'Notification.IM', en: 'Message', ru: 'Сообщение' },
  { alias: 'SystemExclamation', en: 'Exclamation', ru: 'Восклицание' },
  { alias: 'SystemHand', en: 'Error', ru: 'Ошибка' },
] as const;

export type SystemSound = (typeof SYSTEM_SOUNDS)[number]['alias'];

let play: ((sound: string | null, module: unknown, flags: number) => number) | undefined;
let opened = false;

async function open(): Promise<boolean> {
  if (opened) return play !== undefined;
  opened = true;

  if (!(await loadCom())) return false;

  try {
    const winmm = KOFFI.load('winmm.dll');
    play = winmm.func('__stdcall', 'PlaySoundW', 'bool', [
      'char16_t *',
      'void *',
      'uint32',
    ]) as typeof play;
    return true;
  } catch {
    play = undefined;
    return false;
  }
}

export async function soundAvailable(): Promise<boolean> {
  return open();
}

/**
 * Plays one of the system sounds, or nothing at all.
 *
 * An empty name is how "no sound" is expressed, and it is a normal answer
 * rather than a mistake — this is a setting somebody may well turn off.
 * Returns without waiting: the sound is somebody's cue that a timer finished,
 * and the timer has better things to do than watch it finish playing.
 */
export async function playSystemSound(alias: string): Promise<void> {
  if (!alias) return;
  if (!(await open()) || !play) return;

  try {
    play(alias, null, SND_ASYNC | SND_ALIAS | SND_NODEFAULT);
  } catch {
    // A sound that will not play is not a reason for anything else to stop.
  }
}
