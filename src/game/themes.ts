import type { ThemeId } from "./types";

export interface BoardTheme {
  id: ThemeId;
  name: string;
  subtitle: string;
  background: number;
  floor: number;
  board: string;
  boardEdge: number;
  grid: string;
  text: string;
  accent: string;
  black: number;
  white: number;
  swatch: string;
}

export const THEMES: Record<ThemeId, BoardTheme> = {
  walnut: {
    id: "walnut",
    name: "胡桃雅木",
    subtitle: "温润木纹 · 金石落子",
    background: 0x17140f,
    floor: 0x211c15,
    board: "#c99a5b",
    boardEdge: 0x5b341b,
    grid: "rgba(54,31,16,.78)",
    text: "rgba(57,32,15,.78)",
    accent: "#d8b06a",
    black: 0x17191b,
    white: 0xf2eadb,
    swatch: "linear-gradient(135deg,#d6aa6b,#61401f)",
  },
  ink: {
    id: "ink",
    name: "玄墨素瓷",
    subtitle: "墨色棋盘 · 极简留白",
    background: 0x0d1114,
    floor: 0x151b1e,
    board: "#263136",
    boardEdge: 0x080b0d,
    grid: "rgba(199,213,207,.48)",
    text: "rgba(211,221,216,.58)",
    accent: "#a8c5b8",
    black: 0x080a0b,
    white: 0xdde5df,
    swatch: "linear-gradient(135deg,#35444a,#0a0e10)",
  },
  celadon: {
    id: "celadon",
    name: "雨过天青",
    subtitle: "青瓷釉面 · 疏影流光",
    background: 0x14201f,
    floor: 0x1c2c2a,
    board: "#9fc5b7",
    boardEdge: 0x375e55,
    grid: "rgba(27,69,61,.64)",
    text: "rgba(27,69,61,.68)",
    accent: "#d7c68a",
    black: 0x142421,
    white: 0xf0f3e8,
    swatch: "linear-gradient(135deg,#b9d8ca,#46766a)",
  },
  cosmic: {
    id: "cosmic",
    name: "星穹夜弈",
    subtitle: "深空星点 · 冷辉棋盘",
    background: 0x080b18,
    floor: 0x0d1226,
    board: "#202b4b",
    boardEdge: 0x090e20,
    grid: "rgba(145,174,224,.48)",
    text: "rgba(174,196,235,.62)",
    accent: "#b8a7ff",
    black: 0x090c17,
    white: 0xdbe6ff,
    swatch: "linear-gradient(135deg,#344877,#0b1027)",
  },
};

export const THEME_ORDER: ThemeId[] = ["walnut", "ink", "celadon", "cosmic"];
