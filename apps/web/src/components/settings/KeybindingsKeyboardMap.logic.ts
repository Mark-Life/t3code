import type { KeybindingCommand, KeybindingShortcut } from "@t3tools/contracts";
import {
  EVENT_CODE_SHORTCUT_KEYS,
  US_SHIFTED_TO_UNSHIFTED_KEYS,
} from "@t3tools/shared/keybindings";

import { formatShortcutLabel } from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";
import { commandLabel, keybindingGroupFor, type KeybindingRow } from "./KeybindingsSettings.logic";

const KEYBOARD_MODIFIERS = ["ctrl", "alt", "shift", "meta"] as const;
export type KeyboardModifier = (typeof KEYBOARD_MODIFIERS)[number];
export type KeyboardLayer = ReadonlyArray<KeyboardModifier>;

export interface KeyCombo {
  readonly mods: KeyboardLayer;
  readonly key: string;
}

export type KeyCap =
  | { readonly kind: "key"; readonly id: string; readonly label: string; readonly width: number }
  | {
      readonly kind: "modifier";
      readonly modifier: KeyboardModifier;
      readonly label: string;
      readonly width: number;
    }
  | { readonly kind: "fixed"; readonly label: string; readonly width: number }
  | { readonly kind: "stack"; readonly keys: ReadonlyArray<KeyCap>; readonly width: number };

const KEY_LABELS: Readonly<Record<string, string>> = {
  escape: "esc",
  backspace: "⌫",
  tab: "⇥",
  enter: "↩",
  space: "",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

const key = (id: string, width = 1): KeyCap => ({
  kind: "key",
  id,
  label: KEY_LABELS[id] ?? id.toUpperCase(),
  width,
});
const keys = (chars: string) => [...chars].map((char) => key(char));
const modifier = (mod: KeyboardModifier, label: string, width = 1): KeyCap => ({
  kind: "modifier",
  modifier: mod,
  label,
  width,
});
const fixed = (label: string, width = 1): KeyCap => ({ kind: "fixed", label, width });

const MAC_MODIFIER_LABELS: Readonly<Record<KeyboardModifier, string>> = {
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  meta: "⌘",
};
const OTHER_MODIFIER_LABELS: Readonly<Record<KeyboardModifier, string>> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "⇧",
  meta: "Win",
};

const modifierLabel = (mod: KeyboardModifier, platform: string) =>
  (isMacPlatform(platform) ? MAC_MODIFIER_LABELS : OTHER_MODIFIER_LABELS)[mod];

export const layerLabel = (layer: KeyboardLayer, platform: string) =>
  layer.map((mod) => modifierLabel(mod, platform)).join(isMacPlatform(platform) ? "" : "+");

// Every row adds up to 14.5 key units so the edges line up.
export function keyboardLayout(platform: string): ReadonlyArray<ReadonlyArray<KeyCap>> {
  const label = (mod: KeyboardModifier) => modifierLabel(mod, platform);
  const arrows: KeyCap = { kind: "stack", keys: [key("arrowup"), key("arrowdown")], width: 1 };
  const bottomRow = isMacPlatform(platform)
    ? [
        fixed("fn"),
        modifier("ctrl", label("ctrl")),
        modifier("alt", label("alt")),
        modifier("meta", label("meta"), 1.25),
        key("space", 5),
        modifier("meta", label("meta"), 1.25),
        modifier("alt", label("alt")),
      ]
    : [
        modifier("ctrl", label("ctrl"), 1.25),
        fixed("fn"),
        modifier("meta", label("meta")),
        modifier("alt", label("alt"), 1.25),
        key("space", 5),
        modifier("alt", label("alt")),
        modifier("ctrl", label("ctrl")),
      ];
  return [
    [
      key("escape", 1.5),
      ...Array.from({ length: 12 }, (_, index) => ({
        ...key(`f${index + 1}`),
        label: `F${index + 1}`,
      })),
      fixed("⏻"),
    ],
    [...keys("`1234567890-="), key("backspace", 1.5)],
    [key("tab", 1.5), ...keys("qwertyuiop[]\\")],
    [fixed("⇪", 1.75), ...keys("asdfghjkl;'"), key("enter", 1.75)],
    [
      modifier("shift", label("shift"), 2.25),
      ...keys("zxcvbnm,./"),
      modifier("shift", label("shift"), 2.25),
    ],
    [...bottomRow, key("arrowleft"), arrows, key("arrowright")],
  ];
}

const MAP_KEY_IDS: ReadonlySet<string> = new Set(
  keyboardLayout("MacIntel")
    .flat()
    .flatMap((cap) => (cap.kind === "stack" ? cap.keys : [cap]))
    .flatMap((cap) => (cap.kind === "key" ? [cap.id] : [])),
);

export const normalizeLayer = (mods: Iterable<KeyboardModifier>): KeyboardLayer => {
  const set = new Set(mods);
  return KEYBOARD_MODIFIERS.filter((mod) => set.has(mod));
};

export const sameLayer = (left: KeyboardLayer, right: KeyboardLayer) =>
  left.length === right.length && left.every((mod, index) => mod === right[index]);

const comboId = (combo: KeyCombo) => [...combo.mods, combo.key].join("+");

// Shifted US glyphs ("mod++") live on their unshifted key with Shift held.
export function shortcutToCombo(shortcut: KeybindingShortcut, platform: string): KeyCombo | null {
  const unshifted = US_SHIFTED_TO_UNSHIFTED_KEYS.get(shortcut.key);
  const keyId = shortcut.key === " " ? "space" : (unshifted ?? shortcut.key);
  if (!MAP_KEY_IDS.has(keyId)) return null;
  const isMac = isMacPlatform(platform);
  const mods: Array<KeyboardModifier> = [];
  if (shortcut.ctrlKey || (shortcut.modKey && !isMac)) mods.push("ctrl");
  if (shortcut.altKey) mods.push("alt");
  if (shortcut.shiftKey || unshifted !== undefined) mods.push("shift");
  if (shortcut.metaKey || (shortcut.modKey && isMac)) mods.push("meta");
  return { mods, key: keyId };
}

export interface KeyboardIndex {
  readonly byCombo: ReadonlyMap<string, ReadonlyArray<KeybindingRow>>;
  readonly byKey: ReadonlyMap<string, ReadonlyArray<KeybindingRow>>;
  readonly comboByRowId: ReadonlyMap<string, KeyCombo>;
  readonly usedModifiers: ReadonlySet<KeyboardModifier>;
  readonly groupIds: ReadonlySet<string>;
}

export function buildKeyboardIndex(
  rows: ReadonlyArray<KeybindingRow>,
  platform: string,
): KeyboardIndex {
  const byCombo = new Map<string, Array<KeybindingRow>>();
  const byKey = new Map<string, Array<KeybindingRow>>();
  const comboByRowId = new Map<string, KeyCombo>();
  const usedModifiers = new Set<KeyboardModifier>();
  const groupIds = new Set<string>();
  const push = (map: Map<string, Array<KeybindingRow>>, id: string, row: KeybindingRow) => {
    const bucket = map.get(id);
    if (bucket) bucket.push(row);
    else map.set(id, [row]);
  };
  for (const row of rows) {
    const combo = shortcutToCombo(row.binding.shortcut, platform);
    if (!combo) continue;
    comboByRowId.set(row.id, combo);
    push(byCombo, comboId(combo), row);
    push(byKey, combo.key, row);
    for (const mod of combo.mods) usedModifiers.add(mod);
    groupIds.add(keybindingGroupFor(row.command).id);
  }
  return { byCombo, byKey, comboByRowId, usedModifiers, groupIds };
}

// The base layer is an overview: it lists every binding on the key across layers.
export const rowsForCombo = (index: KeyboardIndex, combo: KeyCombo) =>
  (combo.mods.length === 0 ? index.byKey.get(combo.key) : index.byCombo.get(comboId(combo))) ?? [];

export const isFreeCombo = (index: KeyboardIndex, combo: KeyCombo) =>
  combo.mods.length > 0 && rowsForCombo(index, combo).length === 0;

const BROWSER_RESERVED_KEYS = new Set([..."wtnlrq", ..."123456789"]);
const BROWSER_RESERVED_SHIFT_KEYS = new Set(["t", "n"]);

export function isBrowserReservedCombo(combo: KeyCombo, platform: string) {
  const primary: KeyboardModifier = isMacPlatform(platform) ? "meta" : "ctrl";
  if (sameLayer(combo.mods, [primary])) return BROWSER_RESERVED_KEYS.has(combo.key);
  if (sameLayer(combo.mods, normalizeLayer([primary, "shift"]))) {
    return BROWSER_RESERVED_SHIFT_KEYS.has(combo.key);
  }
  return false;
}

function comboToShortcut(combo: KeyCombo): KeybindingShortcut {
  return {
    key: combo.key === "space" ? " " : combo.key,
    metaKey: combo.mods.includes("meta"),
    ctrlKey: combo.mods.includes("ctrl"),
    altKey: combo.mods.includes("alt"),
    shiftKey: combo.mods.includes("shift"),
    modKey: false,
  };
}

export const comboLabel = (combo: KeyCombo, platform: string) =>
  formatShortcutLabel(comboToShortcut(combo), platform);

// Same token order the shortcut recorder writes, so saved keys round-trip.
export function comboToKeybindingInput(combo: KeyCombo, platform: string): string {
  const isMac = isMacPlatform(platform);
  const has = (mod: KeyboardModifier) => combo.mods.includes(mod);
  const parts: Array<string> = [];
  if (has(isMac ? "meta" : "ctrl")) parts.push("mod");
  if (has(isMac ? "ctrl" : "meta")) parts.push(isMac ? "ctrl" : "meta");
  if (has("alt")) parts.push("alt");
  if (has("shift")) parts.push("shift");
  parts.push(combo.key === "escape" ? "esc" : combo.key);
  return parts.join("+");
}

function shortCommandLabel(command: KeybindingCommand): string {
  const parts = commandLabel(command).split(": ");
  const last = parts.at(-1) ?? "";
  return parts.length > 1 && (last === "Toggle" || last === "Open") ? (parts[0] ?? last) : last;
}

export function keyCapState(input: {
  readonly index: KeyboardIndex;
  readonly key: string;
  readonly layer: KeyboardLayer;
  readonly platform: string;
  readonly isBrowser: boolean;
}) {
  const combo = { mods: input.layer, key: input.key };
  const rows = rowsForCombo(input.index, combo);
  const first = rows[0];
  const label = comboLabel(combo, input.platform);
  return {
    rows,
    groupId: first ? keybindingGroupFor(first.command).id : null,
    caption: first && input.layer.length > 0 ? shortCommandLabel(first.command) : null,
    reserved:
      input.isBrowser && input.layer.length > 0 && isBrowserReservedCombo(combo, input.platform),
    ariaLabel:
      rows.length === 0
        ? `${label}: No shortcut`
        : `${label}: ${[...new Set(rows.map((row) => commandLabel(row.command)))].join(", ")}`,
  };
}

const NAMED_CODES: Readonly<Record<string, string>> = {
  Escape: "escape",
  Backspace: "backspace",
  Tab: "tab",
  Enter: "enter",
  Space: "space",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
};

export function keyIdFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) return letter.toLowerCase();
  if (/^F([1-9]|1[0-2])$/.test(code)) return code.toLowerCase();
  return EVENT_CODE_SHORTCUT_KEYS[code] ?? NAMED_CODES[code] ?? null;
}

export const layerFromEvent = (
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): KeyboardLayer =>
  KEYBOARD_MODIFIERS.filter((mod) =>
    mod === "meta"
      ? event.metaKey
      : mod === "ctrl"
        ? event.ctrlKey
        : mod === "alt"
          ? event.altKey
          : event.shiftKey,
  );
