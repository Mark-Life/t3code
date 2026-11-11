import type { KeybindingCommand, KeybindingShortcut } from "@t3tools/contracts";
import {
  EVENT_CODE_SHORTCUT_KEYS,
  US_SHIFTED_TO_UNSHIFTED_KEYS,
} from "@t3tools/shared/keybindings";

import { formatShortcutLabel } from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";
import {
  commandLabel,
  keybindingGroupFor,
  shortcutToKeybindingInput,
  type KeybindingRow,
} from "./KeybindingsSettings.logic";

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

// Every row adds up to 14.5 key units so the edges line up.
function buildLayout(isMac: boolean): ReadonlyArray<ReadonlyArray<KeyCap>> {
  const label = (mod: KeyboardModifier) =>
    (isMac ? MAC_MODIFIER_LABELS : OTHER_MODIFIER_LABELS)[mod];
  const arrows: KeyCap = { kind: "stack", keys: [key("arrowup"), key("arrowdown")], width: 1 };
  const bottomRow = isMac
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

// Built once so memoized keys keep the same `cap` objects across renders.
const MAC_LAYOUT = buildLayout(true);
const OTHER_LAYOUT = buildLayout(false);

export const keyboardLayout = (platform: string) =>
  isMacPlatform(platform) ? MAC_LAYOUT : OTHER_LAYOUT;

const MAP_KEY_IDS: ReadonlySet<string> = new Set(
  MAC_LAYOUT.flat()
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

// Shifted US glyphs ("mod+shift+?") live on their unshifted key. Without `shift` they only
// fire from a dedicated key (numpad "+"), which the map does not draw.
export function shortcutToCombo(shortcut: KeybindingShortcut, platform: string): KeyCombo | null {
  const unshifted = US_SHIFTED_TO_UNSHIFTED_KEYS.get(shortcut.key);
  if (unshifted !== undefined && !shortcut.shiftKey) return null;
  const keyId = shortcut.key === " " ? "space" : (unshifted ?? shortcut.key);
  if (!MAP_KEY_IDS.has(keyId)) return null;
  const isMac = isMacPlatform(platform);
  const mods: Array<KeyboardModifier> = [];
  if (shortcut.ctrlKey || (shortcut.modKey && !isMac)) mods.push("ctrl");
  if (shortcut.altKey) mods.push("alt");
  if (shortcut.shiftKey) mods.push("shift");
  if (shortcut.metaKey || (shortcut.modKey && isMac)) mods.push("meta");
  return { mods, key: keyId };
}

export type KeybindingGroupId = ReturnType<typeof keybindingGroupFor>["id"];

export interface KeyboardIndex {
  readonly byCombo: ReadonlyMap<string, ReadonlyArray<KeybindingRow>>;
  readonly byKey: ReadonlyMap<string, ReadonlyArray<KeybindingRow>>;
  readonly comboByRowId: ReadonlyMap<string, KeyCombo>;
  readonly usedModifiers: ReadonlySet<KeyboardModifier>;
  readonly groupIds: ReadonlySet<KeybindingGroupId>;
}

export function buildKeyboardIndex(
  rows: ReadonlyArray<KeybindingRow>,
  platform: string,
): KeyboardIndex {
  const byCombo = new Map<string, Array<KeybindingRow>>();
  const byKey = new Map<string, Array<KeybindingRow>>();
  const comboByRowId = new Map<string, KeyCombo>();
  const usedModifiers = new Set<KeyboardModifier>();
  const groupIds = new Set<KeybindingGroupId>();
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

// The platform's primary modifier becomes `mod`, as the shortcut recorder writes it.
function comboToShortcut(combo: KeyCombo, platform: string): KeybindingShortcut {
  const primary: KeyboardModifier = isMacPlatform(platform) ? "meta" : "ctrl";
  const has = (mod: KeyboardModifier) => mod !== primary && combo.mods.includes(mod);
  return {
    key: combo.key === "space" ? " " : combo.key,
    metaKey: has("meta"),
    ctrlKey: has("ctrl"),
    altKey: has("alt"),
    shiftKey: has("shift"),
    modKey: combo.mods.includes(primary),
  };
}

export const comboLabel = (combo: KeyCombo, platform: string) =>
  formatShortcutLabel(comboToShortcut(combo, platform), platform);

// An empty key leaves a trailing "+" on non-mac platforms.
export const layerLabel = (layer: KeyboardLayer, platform: string) =>
  comboLabel({ mods: layer, key: "" }, platform).replace(/\+$/, "");

export const comboToKeybindingInput = (combo: KeyCombo, platform: string) =>
  shortcutToKeybindingInput(comboToShortcut(combo, platform));

function shortCommandLabel(command: KeybindingCommand): string {
  const parts = commandLabel(command).split(": ");
  const last = parts.at(-1) ?? "";
  return parts.length > 1 && (last === "Toggle" || last === "Open") ? (parts[0] ?? last) : last;
}

export const selectionNote = (index: KeyboardIndex, selection: KeyCombo) => {
  const count = rowsForCombo(index, selection).length;
  if (count > 0) {
    const noun = count === 1 ? "binding" : "bindings";
    return `${count} ${noun}${selection.mods.length === 0 ? " across all layers" : ""}`;
  }
  return isFreeCombo(index, selection)
    ? "is free."
    : "has no shortcut. Pick a modifier to assign one.";
};

interface KeyCapInput {
  readonly index: KeyboardIndex;
  readonly key: string;
  readonly layer: KeyboardLayer;
  readonly platform: string;
  readonly isBrowser: boolean;
}

export function keyCapState(input: KeyCapInput) {
  const combo = { mods: input.layer, key: input.key };
  const rows = rowsForCombo(input.index, combo);
  const first = rows[0];
  const label = comboLabel(combo, input.platform);
  // The base layer mixes layers, so each command names its own combo.
  const describeRow = (row: KeybindingRow) => {
    const own = input.layer.length === 0 ? input.index.comboByRowId.get(row.id) : undefined;
    const name = commandLabel(row.command);
    return own ? `${comboLabel(own, input.platform)} ${name}` : name;
  };
  return {
    rows,
    groupId: first ? keybindingGroupFor(first.command).id : null,
    caption: first && input.layer.length > 0 ? shortCommandLabel(first.command) : null,
    reserved:
      input.isBrowser && input.layer.length > 0 && isBrowserReservedCombo(combo, input.platform),
    ariaLabel:
      rows.length === 0
        ? `${label}: No shortcut`
        : `${label}: ${[...new Set(rows.map(describeRow))].join(", ")}`,
  };
}

export type KeyCapState = ReturnType<typeof keyCapState>;

const keyStateCache = new WeakMap<KeyboardIndex, Map<string, ReadonlyMap<string, KeyCapState>>>();

// Cached per index and layer so hover previews reuse each layer's key states.
export function keyStatesForLayer(input: Omit<KeyCapInput, "key">) {
  const cacheKey = [input.platform, input.isBrowser, ...input.layer].join("+");
  let byLayer = keyStateCache.get(input.index);
  if (!byLayer) {
    byLayer = new Map();
    keyStateCache.set(input.index, byLayer);
  }
  const cached = byLayer.get(cacheKey);
  if (cached) return cached;
  const states = new Map([...MAP_KEY_IDS].map((key) => [key, keyCapState({ ...input, key })]));
  byLayer.set(cacheKey, states);
  return states;
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

interface KeyBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

// Arrow keys move along DOM order sideways and to the nearest key above or below.
export function nextKeyIndex(boxes: ReadonlyArray<KeyBox>, from: number, key: string) {
  const current = boxes[from];
  if (!current) return null;
  if (key === "Home") return 0;
  if (key === "End") return boxes.length - 1;
  if (key === "ArrowLeft") return from > 0 ? from - 1 : null;
  if (key === "ArrowRight") return from < boxes.length - 1 ? from + 1 : null;
  if (key !== "ArrowUp" && key !== "ArrowDown") return null;
  const down = key === "ArrowDown";
  const bottom = (box: KeyBox) => box.top + box.height;
  const candidates = boxes
    .map((box, index) => ({ box, index }))
    .filter(({ box }) => (down ? box.top >= bottom(current) - 1 : bottom(box) <= current.top + 1));
  const nearest = candidates.reduce<KeyBox | null>((best, { box }) => {
    if (!best) return box;
    return (down ? box.top < best.top : bottom(box) > bottom(best)) ? box : best;
  }, null);
  if (!nearest) return null;
  const center = (box: KeyBox) => box.left + box.width / 2;
  let best: { index: number; distance: number } | null = null;
  for (const { box, index } of candidates) {
    const inRow = down ? box.top < bottom(nearest) : bottom(box) > nearest.top;
    const distance = Math.abs(center(box) - center(current));
    if (inRow && (!best || distance < best.distance)) best = { index, distance };
  }
  return best?.index ?? null;
}
