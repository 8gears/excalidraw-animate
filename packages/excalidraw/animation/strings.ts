import type { HoverRevealMode } from "./hoverReveal";
import type { ElementAnimationDirection, ElementAnimationType } from "./types";

// kept out of the upstream locale files to avoid merge conflicts
export const STRINGS = {
  title: "Animations",
  trigger: "Animate",
  resize: "Drag to resize, double-click to reset",
  empty: "No arrows or lines on the canvas yet.",
  emptyFilter: "Nothing matches this filter.",
  filterAll: "All",
  filterAnimated: "Animated",
  filterSelected: "Selected",
  preview: "Preview & export",
  previewTitle: "Animated SVG",
  previewEmpty: "Nothing to export.",
  previewLoading: "Rendering…",
  download: "Download SVG",
  copy: "Copy SVG",
  copied: "Copied",
  embedScene: "Embed scene (re-editable)",
  optimize: "Optimize size",
  hoverReveal: "Hover reveal",
  hoverRevealHint:
    "Hover needs an interactive SVG: inline, <object> or <iframe>. In an <img> (e.g. GitHub READMEs) or on touch screens the hidden text never appears.",
  animation: "Animation",
  direction: "Direction",
  duration: "Duration (ms)",
  dash: "Dash",
  gap: "Gap",
  arrow: "Arrow",
  line: "Line",
  focus: "Select on canvas",
  selectDot: "Select dot to style it",
  selectDots: "Select dots to style them",
  dotCount: "Dots",
  sequence: "Sequence step (0 = own timing)",
  sequenceOrderSelected: "Order selected:",
  sequenceOrderAll: "Order sequence:",
  sequenceSharedHint:
    "Lines in the same step move together. Order them to play one after another.",
  sequenceLtr: "Left → right",
  sequenceRtl: "Right → left",
  sequenceClear: "Clear",
  dotMissing: "No dot on the canvas, animation disabled.",
  addDot: "Add dot",
  labelPlacement: "Label",
  moreOptions: "More options",
  labelSides: { above: "Above", on: "On line", below: "Below" },
  labelFollowsPath: "Follow curve",
  summary: (total: number, animated: number) =>
    `${total} line${total === 1 ? "" : "s"} · ${animated} animated`,
} as const;

export const TYPE_LABELS: Record<ElementAnimationType | "none", string> = {
  none: "None",
  flow: "Flow (dashes)",
  draw: "Draw",
  pulse: "Pulse",
  dot: "Moving dots",
};

export const HOVER_REVEAL_LABELS: Record<HoverRevealMode, string> = {
  off: "Off, text always visible",
  all: "All text, visible on hover",
  animated: "Labels of animated lines, visible on hover",
};

export const DIRECTION_LABELS: Record<ElementAnimationDirection, string> = {
  forward: "Forward →",
  reverse: "Reverse ←",
  alternate: "Alternate ↔",
};
