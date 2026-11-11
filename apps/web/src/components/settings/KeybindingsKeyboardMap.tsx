import { XIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { cn, isMacPlatform } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  comboLabel,
  isFreeCombo,
  keyboardLayout,
  keyCapState,
  keyIdFromCode,
  layerLabel,
  layerFromEvent,
  normalizeLayer,
  rowsForCombo,
  sameLayer,
  type KeyboardIndex,
  type KeyboardLayer,
  type KeyboardModifier,
  type KeyCap,
  type KeyCombo,
} from "./KeybindingsKeyboardMap.logic";
import { KEYBINDING_GROUP_ORDER } from "./KeybindingsSettings.logic";

// Hovering a list row writes here so only the map re-renders, not the list.
export function createKeyboardPreviewStore() {
  let value: KeyCombo | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: KeyCombo | null) => {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type KeyboardPreviewStore = ReturnType<typeof createKeyboardPreviewStore>;

const GROUP_TINTS: Readonly<Record<string, string>> = {
  navigation: "[--key-tint:var(--info)]",
  threads: "[--key-tint:var(--guest)]",
  composer: "[--key-tint:var(--success)]",
  terminal: "[--key-tint:var(--warning)]",
  preview: "[--key-tint:var(--destructive)]",
  appearance: "[--key-tint:var(--color-yellow-500)]",
  scripts: "[--key-tint:var(--color-teal-500)]",
  other: "[--key-tint:var(--muted-foreground)]",
};

const HATCH_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--warning) 45%, transparent) 4px 5px)",
};

const MODIFIER_NAMES: Readonly<Record<KeyboardModifier, readonly [mac: string, other: string]>> = {
  ctrl: ["Control", "Ctrl"],
  alt: ["Option", "Alt"],
  shift: ["Shift", "Shift"],
  meta: ["Command", "Windows"],
};

interface HeldKeys {
  readonly layer: KeyboardLayer;
  readonly key: string | null;
  readonly recording: boolean;
}

const NO_HELD_KEYS: HeldKeys = { layer: [], key: null, recording: false };

const sameHeld = (left: HeldKeys, right: HeldKeys) =>
  left.key === right.key &&
  left.recording === right.recording &&
  sameLayer(left.layer, right.layer);

function useHeldKeys() {
  const [held, setHeld] = useState(NO_HELD_KEYS);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors physical keys held anywhere on the window
  useEffect(() => {
    const update = (next: HeldKeys) =>
      setHeld((current) => (sameHeld(current, next) ? current : next));
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const recording = Boolean(target?.closest("[data-keybinding-capture]"));
      if (!recording && target?.closest("input, textarea, select, [contenteditable='true']")) {
        update(NO_HELD_KEYS);
        return;
      }
      const key = event.type === "keydown" ? keyIdFromCode(event.code) : null;
      update({ layer: layerFromEvent(event), key, recording });
    };
    const reset = () => update(NO_HELD_KEYS);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return held;
}

const KEY_BASE =
  "relative flex h-9 min-w-0 flex-col items-center justify-center overflow-hidden rounded-md border px-0.5 text-xs leading-none";

interface KeyHighlight {
  readonly layer: KeyboardLayer;
  readonly lit: { readonly key: string | null; readonly mods: KeyboardLayer } | null;
  readonly selectedKey: string | null;
}

function MapKey({
  cap,
  index,
  platform,
  isBrowser,
  highlight,
  onPress,
}: {
  cap: Extract<KeyCap, { kind: "key" }>;
  index: KeyboardIndex;
  platform: string;
  isBrowser: boolean;
  highlight: KeyHighlight;
  onPress: (key: string) => void;
}) {
  const state = keyCapState({ index, key: cap.id, layer: highlight.layer, platform, isBrowser });
  const isLit = highlight.lit?.key === cap.id || highlight.selectedKey === cap.id;
  const isDimmed = highlight.lit !== null && !isLit;
  return (
    <button
      type="button"
      aria-label={state.ariaLabel}
      onClick={() => onPress(cap.id)}
      className={cn(
        KEY_BASE,
        "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        state.groupId
          ? `${GROUP_TINTS[state.groupId] ?? GROUP_TINTS.other} border-(--key-tint) bg-(--key-tint)/15 font-semibold text-foreground`
          : "border-border text-muted-foreground",
        isLit && "border-primary bg-primary text-primary-foreground",
        isDimmed && "opacity-30",
      )}
    >
      {state.reserved ? (
        <span aria-hidden style={HATCH_STYLE} className="pointer-events-none absolute inset-0" />
      ) : null}
      <span className="relative">{cap.label}</span>
      {state.caption ? (
        <span className="relative mt-0.5 max-w-full truncate text-4xs font-normal opacity-80">
          {state.caption}
        </span>
      ) : null}
      {state.rows.length > 1 ? (
        <span className="absolute top-0.5 right-1 text-4xs font-semibold opacity-70">
          {state.rows.length}
        </span>
      ) : null}
    </button>
  );
}

function ModifierKey({
  cap,
  platform,
  isUsed,
  isOn,
  isLit,
  isDimmed,
  onToggle,
}: {
  cap: Extract<KeyCap, { kind: "modifier" }>;
  platform: string;
  isUsed: boolean;
  isOn: boolean;
  isLit: boolean;
  isDimmed: boolean;
  onToggle: (mod: KeyboardModifier) => void;
}) {
  const names = MODIFIER_NAMES[cap.modifier];
  return (
    <button
      type="button"
      aria-pressed={isOn}
      aria-label={isMacPlatform(platform) ? names[0] : names[1]}
      onClick={() => onToggle(cap.modifier)}
      className={cn(
        KEY_BASE,
        "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isUsed ? "border-primary text-foreground" : "border-border text-muted-foreground",
        (isOn || isLit) && "bg-primary text-primary-foreground",
        isDimmed && "opacity-30",
      )}
    >
      {cap.label}
    </button>
  );
}

const keyWidthStyle = (width: number) => ({
  flexGrow: width,
  flexBasis: `calc(${width - 1} * var(--spacing))`,
});

export function KeybindingsKeyboardMap({
  index,
  platform,
  isBrowser,
  selection,
  previewStore,
  canAssign,
  onSelect,
  onAssign,
}: {
  index: KeyboardIndex;
  platform: string;
  isBrowser: boolean;
  selection: KeyCombo | null;
  previewStore: KeyboardPreviewStore;
  canAssign: boolean;
  onSelect: (combo: KeyCombo | null) => void;
  onAssign: (combo: KeyCombo) => void;
}) {
  const [latched, setLatched] = useState<KeyboardLayer>([]);
  const held = useHeldKeys();
  const preview = useSyncExternalStore(previewStore.subscribe, previewStore.get);
  const recordingLit = held.recording ? { key: held.key, mods: held.layer } : null;
  const lit = recordingLit ?? preview;
  const layer =
    recordingLit === null && preview
      ? preview.mods
      : held.recording
        ? latched
        : normalizeLayer([...latched, ...held.layer]);
  const highlight: KeyHighlight = {
    layer,
    lit,
    selectedKey: selection && sameLayer(selection.mods, layer) ? selection.key : null,
  };

  const toggleModifier = (mod: KeyboardModifier) => {
    const next = latched.includes(mod)
      ? latched.filter((entry) => entry !== mod)
      : normalizeLayer([...latched, mod]);
    setLatched(next);
    if (selection) onSelect({ mods: next, key: selection.key });
  };
  const pressKey = (key: string) => {
    const combo = { mods: layer, key };
    onSelect(selection?.key === key && sameLayer(selection.mods, layer) ? null : combo);
  };

  const renderCap = (cap: KeyCap, position: number) => {
    const style = keyWidthStyle(cap.width);
    switch (cap.kind) {
      case "fixed":
        return (
          <div
            key={position}
            aria-hidden
            style={style}
            className={`${KEY_BASE} border-border/50 text-muted-foreground/60`}
          >
            {cap.label}
          </div>
        );
      case "stack":
        return (
          <div key={position} style={style} className="flex min-w-0 flex-col gap-1 [&_button]:h-4">
            {cap.keys.map(renderCap)}
          </div>
        );
      case "modifier":
        return (
          <div key={position} style={style} className="flex min-w-0 *:w-full">
            <ModifierKey
              cap={cap}
              platform={platform}
              isUsed={index.usedModifiers.has(cap.modifier)}
              isOn={layer.includes(cap.modifier)}
              isLit={lit?.mods.includes(cap.modifier) ?? false}
              isDimmed={lit !== null && !lit.mods.includes(cap.modifier)}
              onToggle={toggleModifier}
            />
          </div>
        );
      case "key":
        return (
          <div key={position} style={style} className="flex min-w-0 *:w-full">
            <MapKey
              cap={cap}
              index={index}
              platform={platform}
              isBrowser={isBrowser}
              highlight={highlight}
              onPress={pressKey}
            />
          </div>
        );
    }
  };

  return (
    <div className="sticky top-0 z-10 hidden bg-background pb-2 md:block">
      <div className="rounded-xl border border-border bg-card p-3">
        <div role="group" aria-label="Keyboard map" className="flex flex-col gap-1">
          {keyboardLayout(platform).map((row, rowIndex) => (
            // oxlint-disable-next-line react/no-array-index-key -- the layout is static
            <div key={rowIndex} className="flex gap-1">
              {row.map(renderCap)}
            </div>
          ))}
        </div>
        <KeyboardLegend index={index} platform={platform} isBrowser={isBrowser} layer={layer} />
      </div>
      {selection ? (
        <KeyboardSelectionBar
          index={index}
          platform={platform}
          selection={selection}
          canAssign={canAssign}
          onClear={() => onSelect(null)}
          onAssign={onAssign}
        />
      ) : null}
    </div>
  );
}

function KeyboardLegend({
  index,
  platform,
  isBrowser,
  layer,
}: {
  index: KeyboardIndex;
  platform: string;
  isBrowser: boolean;
  layer: KeyboardLayer;
}) {
  const layerText = layer.length === 0 ? "All layers" : layerLabel(layer, platform);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
      {KEYBINDING_GROUP_ORDER.filter((group) => index.groupIds.has(group.id)).map((group) => (
        <span key={group.id} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`size-2 rounded-xs bg-(--key-tint) ${GROUP_TINTS[group.id] ?? GROUP_TINTS.other}`}
          />
          {group.title}
        </span>
      ))}
      {isBrowser ? (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            style={HATCH_STYLE}
            className="h-2 w-3.5 rounded-xs border border-border"
          />
          Browser may claim
        </span>
      ) : null}
      <span className="ml-auto">
        Layer: <span className="font-medium text-foreground">{layerText}</span>
      </span>
    </div>
  );
}

function KeyboardSelectionBar({
  index,
  platform,
  selection,
  canAssign,
  onClear,
  onAssign,
}: {
  index: KeyboardIndex;
  platform: string;
  selection: KeyCombo;
  canAssign: boolean;
  onClear: () => void;
  onAssign: (combo: KeyCombo) => void;
}) {
  const count = rowsForCombo(index, selection).length;
  const note =
    count > 0
      ? `${count} ${count === 1 ? "binding" : "bindings"}${selection.mods.length === 0 ? " across all layers" : ""}`
      : isFreeCombo(index, selection)
        ? "is free."
        : "has no shortcut. Pick a modifier to assign one.";
  return (
    <div className="mt-2 flex min-h-10 items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
      <span className="font-mono text-sm font-semibold">{comboLabel(selection, platform)}</span>
      <span className="text-muted-foreground">{note}</span>
      {isFreeCombo(index, selection) ? (
        <Button size="compact" disabled={!canAssign} onClick={() => onAssign(selection)}>
          Assign
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost-muted"
        size="icon-sm"
        className="ml-auto"
        aria-label="Clear key filter"
        onClick={onClear}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
