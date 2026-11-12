import { isEditableFocused } from "../lib/editableFocus";
import { registerCommands } from "./dispatcher";

const FUNCTION_KEY_CODE = /^F([1-9]|1[0-2])$/;
const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);
// Popups and dialogs over the page keep their own keys; the settings modal itself does not count.
const KEEPS_OWN_KEYS =
  '[role="dialog"]:not([data-app-modal]), [aria-modal="true"]:not([data-app-modal]), [data-slot$="popup"]:not([data-app-modal]), [data-keybinding-capture]';

let activeLookups = 0;

// Bare keys type, move focus or press buttons, so only chords and F-keys are lookups.
const isPageKey = (event: KeyboardEvent) =>
  !isEditableFocused(event.target) &&
  !(event.target instanceof Element && event.target.closest(KEEPS_OWN_KEYS) !== null);

const isLookupKey = (event: KeyboardEvent) => {
  if (event.isComposing || event.keyCode === 229 || MODIFIER_KEYS.has(event.key)) return false;
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !FUNCTION_KEY_CODE.test(event.code)) {
    return false;
  }
  return isPageKey(event);
};

const isPlainEscape = (event: KeyboardEvent) =>
  event.key === "Escape" &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.metaKey &&
  !event.shiftKey &&
  isPageKey(event);

/** True when the Keybindings settings page takes this press as a lookup, so it must not run. */
export const isKeybindingLookupEvent = (event: KeyboardEvent) =>
  activeLookups > 0 && isLookupKey(event);

/**
 * While registered, shortcuts go to `onLookup` instead of running. Capture phase and newest,
 * so it beats other capture scopes; stopping propagation keeps every later listener out.
 * `onLookup` decides whether to also block the browser default. `onEscape` returns true when it
 * cleared a lookup, so that Escape does not also close the settings modal.
 */
export function registerKeybindingLookup(
  onLookup: (event: KeyboardEvent) => void,
  onEscape: () => boolean,
) {
  activeLookups += 1;
  const unregister = registerCommands(
    {},
    {
      capture: true,
      onKeyDown: (event) => {
        if (isPlainEscape(event)) {
          if (!onEscape()) return false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!isLookupKey(event)) return false;
        event.stopPropagation();
        onLookup(event);
      },
    },
  );
  return () => {
    activeLookups -= 1;
    unregister();
  };
}
