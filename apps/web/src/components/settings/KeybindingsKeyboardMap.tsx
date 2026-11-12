import { XIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { observeResize } from "../../lib/observeResize";
import { cn, isMacPlatform } from "../../lib/utils";
import { registerKeybindingLookup } from "../../shortcuts/keybindingLookup";
import { Button } from "../ui/button";
import {
  comboFromEvent,
  comboLabel,
  isBoundCombo,
  isFreeCombo,
  keyboardLayout,
  keyIdFromCode,
  keyStatesForLayer,
  layerLabel,
  layerFromEvent,
  nextKeyIndex,
  normalizeLayer,
  sameLayer,
  selectionNote,
  type KeybindingGroupId,
  type KeyCapState,
  type KeyboardIndex,
  type KeyboardLayer,
  type KeyboardModifier,
  type KeyCap,
  type KeyCombo,
} from "./KeybindingsKeyboardMap.logic";
import { KEYBINDING_GROUP_ORDER } from "./KeybindingsSettings.logic";

// Hovering a list row writes its id here so only the map re-renders, not the list.
export function createKeyboardPreviewStore() {
  let value: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: string | null) => {
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

const GROUP_TINTS = {
  navigation: "[--key-tint:var(--info)]",
  threads: "[--key-tint:var(--guest)]",
  composer: "[--key-tint:var(--success)]",
  terminal: "[--key-tint:var(--warning)]",
  preview: "[--key-tint:var(--destructive)]",
  appearance: "[--key-tint:var(--color-yellow-500)]",
  scripts: "[--key-tint:var(--color-teal-500)]",
  other: "[--key-tint:var(--muted-foreground)]",
} satisfies Record<KeybindingGroupId, string>;

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

const isInCapture = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[data-keybinding-capture]") !== null;

const isTextField = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("input, textarea, select, [contenteditable='true']") !== null;

function useHeldKeys() {
  const [held, setHeld] = useState(NO_HELD_KEYS);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors physical keys held anywhere on the window
  useEffect(() => {
    const update = (next: HeldKeys) =>
      setHeld((current) => (sameHeld(current, next) ? current : next));
    const onKey = (event: KeyboardEvent) => {
      const recording = isInCapture(event.target);
      if (!recording && isTextField(event.target)) {
        update(NO_HELD_KEYS);
        return;
      }
      const key = recording && event.type === "keydown" ? keyIdFromCode(event.code) : null;
      update({ layer: layerFromEvent(event), key, recording });
    };
    // Focus can leave the recorder by mouse, which fires no key event. Held modifiers stay:
    // clicking a key focuses it while Cmd is still down.
    const onFocus = (event: FocusEvent) => {
      const target = event.type === "focusin" ? event.target : event.relatedTarget;
      const recording = isInCapture(target);
      setHeld((current) => {
        const next =
          !recording && isTextField(target)
            ? NO_HELD_KEYS
            : { layer: current.layer, key: recording ? current.key : null, recording };
        return sameHeld(current, next) ? current : next;
      });
    };
    const reset = () => update(NO_HELD_KEYS);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("focusin", onFocus);
    window.addEventListener("focusout", onFocus);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("focusout", onFocus);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return held;
}

const KEY_BASE =
  "relative flex h-9 min-w-0 flex-col items-center justify-center overflow-hidden rounded-md border px-0.5 text-xs leading-none";
const KEY_FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const KEY_FILLED = "bg-primary text-primary-foreground focus-visible:ring-primary-foreground";

const MapKey = memo(function MapKey({
  cap,
  state,
  isLit,
  isSelected,
  isDimmed,
  isTabStop,
  isCompact,
  onPress,
}: {
  cap: Extract<KeyCap, { kind: "key" }>;
  state: KeyCapState | undefined;
  isCompact: boolean;
  isLit: boolean;
  isSelected: boolean;
  isDimmed: boolean;
  isTabStop: boolean;
  onPress: (key: string) => void;
}) {
  return (
    <button
      type="button"
      data-nav-id={cap.id}
      tabIndex={isTabStop ? 0 : -1}
      aria-pressed={isSelected}
      aria-label={state?.ariaLabel ?? cap.label}
      onClick={() => onPress(cap.id)}
      onContextMenu={(event) => {
        // macOS turns Ctrl+click into a context menu click, so `click` never fires.
        if (!event.ctrlKey || event.button !== 0) return;
        event.preventDefault();
        onPress(cap.id);
      }}
      className={cn(
        KEY_BASE,
        KEY_FOCUS,
        state?.groupId
          ? `${GROUP_TINTS[state.groupId]} border-(--key-tint) bg-(--key-tint)/15 font-semibold text-foreground`
          : "border-border text-muted-foreground",
        (isLit || isSelected) && `border-primary ${KEY_FILLED}`,
        isDimmed && "opacity-30",
      )}
    >
      {state?.reserved ? (
        <span aria-hidden style={HATCH_STYLE} className="pointer-events-none absolute inset-0" />
      ) : null}
      <span className="relative">{cap.label}</span>
      {/* Stacked arrow keys are too short for text; the aria-label still names the command. */}
      {state?.caption && !isCompact ? (
        <span className="relative mt-0.5 max-w-full truncate text-4xs font-normal opacity-80">
          {state.caption}
        </span>
      ) : null}
      {state && state.rows.length > 1 && !isCompact ? (
        <span className="absolute top-0.5 right-1 text-4xs font-semibold opacity-70">
          {state.rows.length}
        </span>
      ) : null}
    </button>
  );
});

const ModifierKey = memo(function ModifierKey({
  cap,
  navId,
  platform,
  isUsed,
  isOn,
  isLit,
  isDimmed,
  isTabStop,
  onToggle,
}: {
  cap: Extract<KeyCap, { kind: "modifier" }>;
  navId: string;
  platform: string;
  isUsed: boolean;
  isOn: boolean;
  isLit: boolean;
  isDimmed: boolean;
  isTabStop: boolean;
  onToggle: (mod: KeyboardModifier) => void;
}) {
  const names = MODIFIER_NAMES[cap.modifier];
  return (
    <button
      type="button"
      data-nav-id={navId}
      tabIndex={isTabStop ? 0 : -1}
      aria-pressed={isOn}
      aria-label={isMacPlatform(platform) ? names[0] : names[1]}
      onClick={() => onToggle(cap.modifier)}
      className={cn(
        KEY_BASE,
        KEY_FOCUS,
        isUsed ? "border-primary text-foreground" : "border-border text-muted-foreground",
        (isOn || isLit) && KEY_FILLED,
        isDimmed && "opacity-30",
      )}
    >
      {cap.label}
    </button>
  );
});

const STICKY_MEDIA_QUERY = "(min-height: 45rem)";

// Pads the scroll area by the sticky map's height so focused rows never land under it.
const padScrollAreaForMap = (node: HTMLDivElement) => {
  const scrollArea = node.closest<HTMLElement>("[data-settings-page-scroll]");
  if (!scrollArea) return;
  const media = window.matchMedia(STICKY_MEDIA_QUERY);
  const update = () => {
    scrollArea.style.scrollPaddingTop =
      media.matches && node.offsetHeight > 0
        ? `calc(var(--workspace-titlebar-scroll-fade-height) + ${node.offsetHeight}px)`
        : "";
  };
  const stopObserving = observeResize(node, update);
  media.addEventListener("change", update);
  return () => {
    stopObserving();
    media.removeEventListener("change", update);
    scrollArea.style.scrollPaddingTop = "";
  };
};

const keyWidthStyle = (width: number) => ({
  flexGrow: width,
  flexBasis: `calc(${width - 1} * var(--spacing))`,
});

const moveKeyFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-nav-id]")];
  const from = buttons.findIndex((button) => button === event.target);
  const next =
    buttons[
      nextKeyIndex(
        buttons.map((button) => button.getBoundingClientRect()),
        from,
        event.key,
      ) ?? -1
    ];
  if (!next) return;
  event.preventDefault();
  next.focus();
};

export function KeybindingsKeyboardMap({
  index,
  platform,
  isBrowser,
  selection,
  previewStore,
  canAssign,
  lookupShortcuts,
  onSelect,
  onAssign,
}: {
  index: KeyboardIndex;
  platform: string;
  isBrowser: boolean;
  /** Pressed shortcuts select their key instead of running. */
  lookupShortcuts: boolean;
  selection: KeyCombo | null;
  previewStore: KeyboardPreviewStore;
  canAssign: boolean;
  onSelect: (combo: KeyCombo | null) => void;
  onAssign: (combo: KeyCombo) => void;
}) {
  const [latched, setLatched] = useState<KeyboardLayer>([]);
  const [tabStop, setTabStop] = useState("escape");
  const held = useHeldKeys();
  const keysRef = useRef<HTMLDivElement>(null);
  const previewRowId = useSyncExternalStore(previewStore.subscribe, previewStore.get);
  // Resolved per render so a row rebound under the pointer never previews its old combo.
  const preview = previewRowId === null ? null : (index.comboByRowId.get(previewRowId) ?? null);
  const recordingLit =
    held.recording && (held.key !== null || held.layer.length > 0)
      ? { key: held.key, mods: held.layer }
      : null;
  const lit = recordingLit ?? preview;
  const baseLayer = held.recording ? latched : normalizeLayer([...latched, ...held.layer]);
  const layer = recordingLit === null && preview ? preview.mods : baseLayer;
  const keyStates = keyStatesForLayer({ index, layer, platform, isBrowser });
  const selectedKey = selection && sameLayer(selection.mods, layer) ? selection.key : null;

  const toggleModifier = (mod: KeyboardModifier) => {
    const next = latched.includes(mod)
      ? latched.filter((entry) => entry !== mod)
      : normalizeLayer([...latched, mod]);
    setLatched(next);
    if (selection) onSelect({ mods: next, key: selection.key });
  };
  // Held modifiers get latched so the selection stays visible after they are released.
  const pressKey = (key: string) => {
    setLatched(baseLayer);
    const isSame = selection?.key === key && sameLayer(selection.mods, baseLayer);
    onSelect(isSame ? null : { mods: baseLayer, key });
  };
  // Free combos keep the browser default, such as copy or reload.
  const lookUp = useEffectEvent((event: KeyboardEvent) => {
    const combo = comboFromEvent(event);
    if (combo === null) return;
    if (isBoundCombo(index, combo)) event.preventDefault();
    if (event.repeat) return;
    setLatched(combo.mods);
    onSelect(combo);
  });
  // The first Escape clears the lookup; the next one closes settings.
  const clearLookup = useEffectEvent(() => {
    if (selection === null && latched.length === 0) return false;
    setLatched([]);
    onSelect(null);
    return true;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- claims shortcuts pressed anywhere on the window while the map is shown
  useEffect(() => {
    if (!lookupShortcuts) return;
    return registerKeybindingLookup(
      (event) => lookUp(event),
      () => clearLookup(),
    );
  }, [lookupShortcuts]);

  const renderCap = (
    cap: KeyCap,
    position: number,
    rowIndex: number,
    isStacked = false,
  ): ReactNode => {
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
            {cap.keys.map((inner, innerPosition) =>
              renderCap(inner, innerPosition, rowIndex, true),
            )}
          </div>
        );
      case "modifier": {
        const navId = `${cap.modifier}-${rowIndex}-${position}`;
        return (
          <div key={position} style={style} className="flex min-w-0 *:w-full">
            <ModifierKey
              cap={cap}
              navId={navId}
              platform={platform}
              isUsed={index.usedModifiers.has(cap.modifier)}
              isOn={layer.includes(cap.modifier)}
              isLit={lit?.mods.includes(cap.modifier) ?? false}
              isDimmed={lit !== null && !lit.mods.includes(cap.modifier)}
              isTabStop={tabStop === navId}
              onToggle={toggleModifier}
            />
          </div>
        );
      }
      case "key": {
        const isLit = lit?.key === cap.id;
        const isSelected = selectedKey === cap.id;
        return (
          <div key={position} style={style} className="flex min-w-0 *:w-full">
            <MapKey
              cap={cap}
              state={keyStates.get(cap.id)}
              isLit={isLit}
              isSelected={isSelected}
              isDimmed={lit !== null && !isLit && !isSelected}
              isTabStop={tabStop === cap.id}
              isCompact={isStacked}
              onPress={pressKey}
            />
          </div>
        );
      }
    }
  };

  return (
    <div
      ref={padScrollAreaForMap}
      className="top-(--workspace-titlebar-scroll-fade-height) z-10 hidden bg-background pb-2 md:block [@media(min-height:45rem)]:sticky"
    >
      <div className="rounded-xl border border-border bg-card p-3">
        <div
          ref={keysRef}
          role="group"
          aria-label="Keyboard map"
          className="flex flex-col gap-1"
          onKeyDown={moveKeyFocus}
          onFocus={(event) => {
            const navId = event.target instanceof HTMLElement ? event.target.dataset.navId : null;
            if (navId) setTabStop(navId);
          }}
        >
          {keyboardLayout(platform).map((row, rowIndex) => (
            // oxlint-disable-next-line react/no-array-index-key -- the layout is static
            <div key={rowIndex} className="flex gap-1">
              {row.map((cap, position) => renderCap(cap, position, rowIndex))}
            </div>
          ))}
        </div>
        <KeyboardLegend platform={platform} isBrowser={isBrowser} layer={layer} />
      </div>
      <p role="status" className="sr-only">
        {selection ? `${comboLabel(selection, platform)} ${selectionNote(index, selection)}` : ""}
      </p>
      {selection ? (
        <KeyboardSelectionBar
          index={index}
          platform={platform}
          selection={selection}
          canAssign={canAssign}
          onClear={() => {
            // The bar unmounts on clear, so hand focus back to the key it described.
            keysRef.current
              ?.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(selection.key)}"]`)
              ?.focus();
            onSelect(null);
          }}
          onAssign={onAssign}
        />
      ) : (
        // Holds the bar's space so selecting a key does not move the list.
        <div aria-hidden className={`${BAR_CLASS} invisible`} />
      )}
    </div>
  );
}

function KeyboardLegend({
  platform,
  isBrowser,
  layer,
}: {
  platform: string;
  isBrowser: boolean;
  layer: KeyboardLayer;
}) {
  const layerText = layer.length === 0 ? "All layers" : layerLabel(layer, platform);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
      {KEYBINDING_GROUP_ORDER.map((group) => (
        <span key={group.id} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`size-2 rounded-xs bg-(--key-tint) ${GROUP_TINTS[group.id]}`}
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

// The hint holds the bar's place so selecting a key never moves the list.
const BAR_CLASS =
  "mt-2 flex min-h-10 items-center gap-2.5 rounded-lg border border-border px-3 py-1.5 text-xs";

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
  return (
    <div className={`${BAR_CLASS} bg-card`}>
      <span className="font-mono text-sm font-semibold">{comboLabel(selection, platform)}</span>
      <span className="text-muted-foreground">{selectionNote(index, selection)}</span>
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
