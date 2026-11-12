import {
  compileResolvedKeybindingsConfig,
  parseKeybindingShortcut,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import {
  buildKeyboardIndex,
  comboToKeybindingInput,
  isBrowserReservedCombo,
  isBoundCombo,
  isFreeCombo,
  keyCapState,
  layerLabel,
  nextKeyIndex,
  rowsForCombo,
  shortcutToCombo,
} from "./KeybindingsKeyboardMap.logic";
import { buildKeybindingRows } from "./KeybindingsSettings.logic";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";

const combo = (value: string, platform: string) => {
  const shortcut = parseKeybindingShortcut(value);
  if (!shortcut) throw new Error(`Bad shortcut ${value}`);
  return shortcutToCombo(shortcut, platform);
};

describe("shortcutToCombo", () => {
  it.each([
    ["mod+k", MAC, { mods: ["meta"], key: "k" }],
    ["mod+k", LINUX, { mods: ["ctrl"], key: "k" }],
    ["meta+k", LINUX, { mods: ["meta"], key: "k" }],
    ["ctrl+k", MAC, { mods: ["ctrl"], key: "k" }],
    ["mod+shift+alt+arrowup", MAC, { mods: ["alt", "shift", "meta"], key: "arrowup" }],
    ["mod+shift+?", MAC, { mods: ["shift", "meta"], key: "/" }],
    ["space", MAC, { mods: [], key: "space" }],
    ["esc", LINUX, { mods: [], key: "escape" }],
    ["shift+f6", MAC, { mods: ["shift"], key: "f6" }],
  ])("places %s on %s", (value, platform, expected) => {
    expect(combo(value, platform)).toEqual(expected);
  });

  it.each(["mod+pagedown", "mod++"])("skips %s, which no drawn key can type", (value) => {
    expect(combo(value, MAC)).toBeNull();
  });
});

describe("keyboard index", () => {
  const rows = buildKeybindingRows(
    compileResolvedKeybindingsConfig([
      { command: "terminal.toggle", key: "mod+j" },
      { command: "terminal.split", key: "mod+shift+j" },
      { command: "diff.toggle", key: "mod+shift+j", when: "terminalFocus" },
      { command: "chat.new", key: "ctrl+n" },
    ]),
    MAC,
  );
  const index = buildKeyboardIndex(rows, MAC);
  const commands = (mods: ReadonlyArray<"ctrl" | "alt" | "shift" | "meta">, key: string) =>
    rowsForCombo(index, { mods, key }).map((row) => row.command);

  it("matches modifier layers exactly and lists every layer on the base", () => {
    expect(commands(["meta"], "j")).toEqual(["terminal.toggle"]);
    expect(commands(["shift", "meta"], "j").toSorted()).toEqual(["diff.toggle", "terminal.split"]);
    expect(commands([], "j")).toHaveLength(3);
    expect(commands(["meta"], "n")).toEqual([]);
    expect(commands(["ctrl"], "n")).toEqual(["chat.new"]);
  });

  it("records used modifiers", () => {
    expect([...index.usedModifiers].toSorted()).toEqual(["ctrl", "meta", "shift"]);
  });

  it("calls a combo free only in a modifier layer with no binding", () => {
    expect(isFreeCombo(index, { mods: ["meta"], key: "y" })).toBe(true);
    expect(isFreeCombo(index, { mods: ["meta"], key: "j" })).toBe(false);
    expect(isFreeCombo(index, { mods: [], key: "y" })).toBe(false);
    expect(isBoundCombo(index, { mods: ["meta"], key: "j" })).toBe(true);
    expect(isBoundCombo(index, { mods: [], key: "j" })).toBe(false);
  });

  it("captions and counts keys only from their own layer", () => {
    const shifted = keyCapState({
      index,
      key: "j",
      layer: ["shift", "meta"],
      platform: MAC,
      isBrowser: false,
    });
    expect(shifted.rows).toHaveLength(2);
    expect(shifted.caption).not.toBeNull();
    const base = keyCapState({ index, key: "j", layer: [], platform: MAC, isBrowser: false });
    expect(base.caption).toBeNull();
    expect(base.rows).toHaveLength(3);
    expect(base.ariaLabel).toBe("J: ⇧⌘J Diff: Toggle, ⇧⌘J Terminal: Split, ⌘J Terminal: Toggle");
    const free = keyCapState({ index, key: "y", layer: ["meta"], platform: MAC, isBrowser: true });
    expect(free.ariaLabel).toBe("⌘Y: No shortcut");
  });
});

describe("browser reserved combos", () => {
  it.each([
    [{ mods: ["meta"], key: "w" }, MAC, true],
    [{ mods: ["shift", "meta"], key: "t" }, MAC, true],
    [{ mods: ["ctrl"], key: "1" }, LINUX, true],
    [{ mods: ["ctrl"], key: "w" }, MAC, false],
    [{ mods: ["shift", "meta"], key: "w" }, MAC, false],
    [{ mods: ["meta"], key: "k" }, MAC, false],
  ] as const)("%o on %s is %s", (value, platform, expected) => {
    expect(isBrowserReservedCombo(value, platform)).toBe(expected);
  });
});

describe("comboToKeybindingInput", () => {
  it.each([
    [{ mods: ["shift", "meta"], key: "y" }, MAC, "mod+shift+y"],
    [{ mods: ["ctrl", "meta"], key: "y" }, MAC, "mod+ctrl+y"],
    [{ mods: ["ctrl", "alt"], key: "escape" }, LINUX, "mod+alt+esc"],
    [{ mods: ["meta"], key: "space" }, LINUX, "meta+space"],
  ] as const)("writes %o on %s as %s", (value, platform, expected) => {
    expect(comboToKeybindingInput(value, platform)).toBe(expected);
    expect(combo(expected, platform)).toEqual(value);
  });
});

describe("layerLabel", () => {
  it.each([
    [["ctrl", "shift"], LINUX, "Ctrl+Shift"],
    [["meta"], LINUX, "Meta"],
    [["shift", "meta"], MAC, "⇧⌘"],
  ] as const)("names %o on %s as %s", (layer, platform, expected) => {
    expect(layerLabel(layer, platform)).toBe(expected);
  });
});

describe("nextKeyIndex", () => {
  const box = (left: number, top: number, height = 36) => ({ left, top, width: 36, height });
  // A key above a row holding a short stacked pair of arrows.
  const boxes = [box(80, 0), box(0, 40), box(40, 40, 16), box(40, 60, 16), box(80, 40)];

  it.each([
    [0, "ArrowDown", 4],
    [2, "ArrowDown", 3],
    [3, "ArrowUp", 2],
    [1, "ArrowUp", 0],
    [0, "ArrowLeft", null],
    [1, "ArrowRight", 2],
    [4, "End", 4],
    [0, "ArrowUp", null],
  ] as const)("moves from %i with %s to %s", (from, key, expected) => {
    expect(nextKeyIndex(boxes, from, key)).toBe(expected);
  });
});
