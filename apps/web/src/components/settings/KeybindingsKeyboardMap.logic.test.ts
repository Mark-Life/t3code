import {
  compileResolvedKeybindingsConfig,
  parseKeybindingShortcut,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import {
  buildKeyboardIndex,
  comboToKeybindingInput,
  isBrowserReservedCombo,
  isFreeCombo,
  keyboardLayout,
  keyCapState,
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
    ["mod++", MAC, { mods: ["shift", "meta"], key: "=" }],
    ["space", MAC, { mods: [], key: "space" }],
    ["esc", LINUX, { mods: [], key: "escape" }],
    ["shift+f6", MAC, { mods: ["shift"], key: "f6" }],
  ])("places %s on %s", (value, platform, expected) => {
    expect(combo(value, platform)).toEqual(expected);
  });

  it("skips keys the drawn keyboard does not have", () => {
    expect(combo("mod+pagedown", MAC)).toBeNull();
  });
});

describe("keyboardLayout", () => {
  it.each([MAC, LINUX])("keeps every row the same width on %s", (platform) => {
    const widths = keyboardLayout(platform).map((row) =>
      row.reduce((total, cap) => total + cap.width, 0),
    );
    expect(new Set(widths)).toEqual(new Set([14.5]));
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

  it("records used modifiers and groups", () => {
    expect([...index.usedModifiers].toSorted()).toEqual(["ctrl", "meta", "shift"]);
    expect([...index.groupIds].toSorted()).toEqual(["preview", "terminal", "threads"]);
  });

  it("calls a combo free only in a modifier layer with no binding", () => {
    expect(isFreeCombo(index, { mods: ["meta"], key: "y" })).toBe(true);
    expect(isFreeCombo(index, { mods: ["meta"], key: "j" })).toBe(false);
    expect(isFreeCombo(index, { mods: [], key: "y" })).toBe(false);
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
