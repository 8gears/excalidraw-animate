// [excalidraw-animate] label offset: moves a line/arrow label off the line
// (above/below), while it stays bound to it.

import type { GlobalPoint } from "@excalidraw/math";

import type { ExcalidrawTextElement } from "./types";

export const LABEL_OFFSET_CUSTOM_DATA_KEY = "labelOffset";

/** distance of the label center from the line, in px; 0 = on the line */
export const getLabelOffset = (text: ExcalidrawTextElement) => {
  const offset = text.customData?.[LABEL_OFFSET_CUSTOM_DATA_KEY];
  return typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
};

/** path parameter range used to estimate the line direction at the label */
const TANGENT_SPAN = 0.02;

/**
 * Shifts a label position perpendicular to the line at the label. The normal
 * is oriented down (or right, for vertical lines), so a positive offset puts
 * the label below the line and a negative one above, whichever way the line
 * was drawn.
 *
 * @param pointAt point on the line at a path parameter in [0, 1]
 */
export const applyLabelOffset = (
  text: ExcalidrawTextElement,
  position: { x: number; y: number },
  pointAt: (pathParameter: number) => GlobalPoint | null,
) => {
  const offset = getLabelOffset(text);
  if (!offset) {
    return position;
  }
  const t = text.labelPosition ?? 0.5;
  const a = pointAt(Math.max(0, t - TANGENT_SPAN));
  const b = pointAt(Math.min(1, t + TANGENT_SPAN));
  if (!a || !b) {
    return position;
  }
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!length) {
    return position;
  }
  let nx = -dy / length;
  let ny = dx / length;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: position.x + nx * offset, y: position.y + ny * offset };
};

/**
 * Offset that places the label just clear of the line on one side, taking
 * the label's size in the direction of the normal into account.
 */
export const getClearLabelOffset = (
  text: ExcalidrawTextElement,
  side: "above" | "below",
  lineStrokeWidth: number,
  pointAt: (pathParameter: number) => GlobalPoint | null,
) => {
  const t = text.labelPosition ?? 0.5;
  const a = pointAt(Math.max(0, t - TANGENT_SPAN));
  const b = pointAt(Math.min(1, t + TANGENT_SPAN));
  let extent = text.height / 2;
  if (a && b) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // |normal| components are |tangent| components swapped
    const nx = Math.abs(b[1] - a[1]) / length;
    const ny = Math.abs(b[0] - a[0]) / length;
    extent = (nx * text.width + ny * text.height) / 2;
  }
  const clearance = extent + lineStrokeWidth / 2 + 6;
  return side === "above" ? -clearance : clearance;
};
