// [excalidraw-animate] curved labels: a line/arrow label that follows the
// line's shape instead of sitting on it as a straight box. Opt-in per label
// (`customData.labelFollowsPath`), so scenes without it render unchanged and
// upstream Excalidraw shows such labels straight.

import {
  applyDarkModeFilter,
  BOUND_TEXT_PADDING,
  getFontString,
} from "@excalidraw/common";

import type { GlobalPoint } from "@excalidraw/math";

import { getLabelOffset } from "./labelOffset";
import { getLineHeightInPx, getLineWidth } from "./textMeasurements";
import { isLinearElement } from "./typeChecks";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "./types";

/**
 * `LinearElementEditor.getPointAtPathParameter`, passed in by callers:
 * importing it here would create an import cycle through the renderer.
 */
export type PathSampler = (
  container: ExcalidrawLinearElement,
  pathParameter: number,
  elementsMap: ElementsMap,
) => GlobalPoint | null;

export const LABEL_FOLLOWS_PATH_CUSTOM_DATA_KEY = "labelFollowsPath";

const SVG_NS = "http://www.w3.org/2000/svg";
/** path samples used to walk the line by arc length */
const PATH_SAMPLES = 96;

type Point = readonly [number, number];

type SampledPath = {
  points: Point[];
  /** cumulative arc length at each point */
  lengths: number[];
  length: number;
};

export type CurvedLabelLayout = {
  container: ExcalidrawLinearElement;
  /** the line, in reading direction (left to right) */
  path: SampledPath;
  /** arc length of the label center along `path` */
  center: number;
  font: ReturnType<typeof getFontString>;
  lineHeight: number;
  /** each text line and its distance from the path (along the normal) */
  lines: { text: string; width: number; offset: number }[];
};

export const isLabelFollowingPath = (element: ExcalidrawElement) =>
  element.type === "text" &&
  !!element.containerId &&
  element.customData?.[LABEL_FOLLOWS_PATH_CUSTOM_DATA_KEY] === true;

const samplePath = (
  container: ExcalidrawLinearElement,
  elementsMap: ElementsMap,
  sampler: PathSampler,
): SampledPath | null => {
  const points: Point[] = [];
  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const point = sampler(container, i / PATH_SAMPLES, elementsMap);
    if (!point) {
      return null;
    }
    points.push([point[0], point[1]]);
  }
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(
      lengths[i - 1] +
        Math.hypot(
          points[i][0] - points[i - 1][0],
          points[i][1] - points[i - 1][1],
        ),
    );
  }
  const length = lengths[lengths.length - 1];
  return length > 0 ? { points, lengths, length } : null;
};

const reversePath = (path: SampledPath): SampledPath => ({
  points: [...path.points].reverse(),
  lengths: path.lengths.map((l) => path.length - l).reverse(),
  length: path.length,
});

/**
 * Point and unit tangent at arc length `s`; beyond the ends the first/last
 * segment is extended, so labels longer than the line still get a place.
 */
const pointAtLength = (path: SampledPath, s: number) => {
  const { points, lengths } = path;
  let i = 0;
  if (s >= path.length) {
    i = points.length - 2;
  } else if (s > 0) {
    while (i < points.length - 2 && lengths[i + 1] < s) {
      i++;
    }
  }
  // skip zero-length segments for a usable tangent
  let j = i + 1;
  while (j < points.length - 1 && lengths[j] - lengths[i] === 0) {
    j++;
  }
  const [x0, y0] = points[i];
  const [x1, y1] = points[j];
  const segment = lengths[j] - lengths[i] || 1;
  const tx = (x1 - x0) / segment;
  const ty = (y1 - y0) / segment;
  const along = s - lengths[i];
  return { x: x0 + tx * along, y: y0 + ty * along, tx, ty };
};

/** normal of the reading direction; points down (or right, when vertical) */
const normalAt = (p: { tx: number; ty: number }) => ({ nx: -p.ty, ny: p.tx });

export const getCurvedLabelLayout = (
  text: ExcalidrawTextElement,
  elementsMap: ElementsMap,
  sampler: PathSampler,
): CurvedLabelLayout | null => {
  if (!isLabelFollowingPath(text)) {
    return null;
  }
  const container = elementsMap.get(text.containerId!);
  if (
    !container ||
    !isLinearElement(container) ||
    container.points.length < 2
  ) {
    return null;
  }
  let path = samplePath(container, elementsMap, sampler);
  if (!path) {
    return null;
  }
  let center = (text.labelPosition ?? 0.5) * path.length;

  // read left to right: flip lines that run right to left (and, for
  // vertical ones, bottom to top), so the text is never upside down
  const direction = pointAtLength(path, center);
  if (direction.tx < 0 || (direction.tx === 0 && direction.ty > 0)) {
    path = reversePath(path);
    center = path.length - center;
  }

  const font = getFontString(text);
  const lineHeight = getLineHeightInPx(text.fontSize, text.lineHeight);
  const textLines = text.text.replace(/\r\n?/g, "\n").split("\n");
  const offset = getLabelOffset(text);
  return {
    container,
    path,
    center,
    font,
    lineHeight,
    lines: textLines.map((line, i) => ({
      text: line,
      width: getLineWidth(line, font),
      offset: offset + (i - (textLines.length - 1) / 2) * lineHeight,
    })),
  };
};

export type CurvedGlyph = {
  char: string;
  x: number;
  y: number;
  /** rotation in radians */
  angle: number;
};

/** every character, centered on its spot along the (offset) path */
export const getCurvedLabelGlyphs = (layout: CurvedLabelLayout) => {
  const glyphs: CurvedGlyph[] = [];
  for (const line of layout.lines) {
    const start = layout.center - line.width / 2;
    const chars = [...line.text];
    let prefix = "";
    for (const char of chars) {
      const before = getLineWidth(prefix, layout.font);
      const width = getLineWidth(char, layout.font);
      prefix += char;
      if (!char.trim()) {
        continue;
      }
      const p = pointAtLength(layout.path, start + before + width / 2);
      const { nx, ny } = normalAt(p);
      glyphs.push({
        char,
        x: p.x + nx * line.offset,
        y: p.y + ny * line.offset,
        angle: Math.atan2(p.ty, p.tx),
      });
    }
  }
  return glyphs;
};

/**
 * The band the label covers along the line, as a closed polygon in scene
 * coordinates: used instead of the straight label box to cut the line's gap.
 */
export const getCurvedLabelHole = (layout: CurvedLabelLayout): Point[] => {
  const maxWidth = Math.max(...layout.lines.map((line) => line.width));
  const from = layout.center - maxWidth / 2 - BOUND_TEXT_PADDING;
  const to = layout.center + maxWidth / 2 + BOUND_TEXT_PADDING;
  const offsets = layout.lines.map((line) => line.offset);
  const near =
    Math.min(...offsets) - layout.lineHeight / 2 - BOUND_TEXT_PADDING;
  const far = Math.max(...offsets) + layout.lineHeight / 2 + BOUND_TEXT_PADDING;

  const steps = Math.max(8, Math.ceil((to - from) / 6));
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = pointAtLength(layout.path, from + ((to - from) * i) / steps);
    const { nx, ny } = normalAt(p);
    upper.push([p.x + nx * near, p.y + ny * near]);
    lower.push([p.x + nx * far, p.y + ny * far]);
  }
  return [...upper, ...lower.reverse()];
};

/**
 * Traces the curved label's gap into the current canvas path (for an
 * even-odd clip). Returns false for regular labels, so the caller falls
 * back to the straight box.
 *
 * @param toCanvas maps scene coordinates into the context's space
 */
export const traceCurvedLabelHole = (
  context: CanvasRenderingContext2D,
  text: ExcalidrawTextElement,
  elementsMap: ElementsMap,
  sampler: PathSampler,
  toCanvas: (x: number, y: number) => readonly [number, number],
) => {
  const layout = getCurvedLabelLayout(text, elementsMap, sampler);
  if (!layout) {
    return false;
  }
  getCurvedLabelHole(layout).forEach(([x, y], i) => {
    const [cx, cy] = toCanvas(x, y);
    if (i === 0) {
      context.moveTo(cx, cy);
    } else {
      context.lineTo(cx, cy);
    }
  });
  context.closePath();
  return true;
};

/**
 * Draws a curved label directly (vector, uncached). Returns false for
 * regular labels, so the caller renders them as usual.
 *
 * @param translate scene -> context offset (scroll and render offset)
 */
export const drawCurvedLabel = (
  text: ExcalidrawTextElement,
  elementsMap: ElementsMap,
  sampler: PathSampler,
  context: CanvasRenderingContext2D,
  isDarkMode: boolean,
  translate: { x: number; y: number },
) => {
  const layout = getCurvedLabelLayout(text, elementsMap, sampler);
  if (!layout) {
    return false;
  }
  context.save();
  context.translate(translate.x, translate.y);
  context.font = layout.font;
  context.fillStyle = applyDarkModeFilter(text.strokeColor, isDarkMode);
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const glyph of getCurvedLabelGlyphs(layout)) {
    context.save();
    context.translate(glyph.x, glyph.y);
    context.rotate(glyph.angle);
    context.fillText(glyph.char, 0, 0);
    context.restore();
  }
  context.restore();
  return true;
};

const pathData = (points: readonly Point[], close = false) =>
  points
    .map(
      ([x, y], i) =>
        `${i ? "L" : "M"}${Math.round(x * 100) / 100} ${
          Math.round(y * 100) / 100
        }`,
    )
    .join(" ") + (close ? " Z" : "");

/** SVG path data of the curved label's gap, shifted into export space */
export const getCurvedLabelHolePathData = (
  text: ExcalidrawTextElement,
  elementsMap: ElementsMap,
  sampler: PathSampler,
  shiftX: number,
  shiftY: number,
) => {
  const layout = getCurvedLabelLayout(text, elementsMap, sampler);
  if (!layout) {
    return null;
  }
  return pathData(
    getCurvedLabelHole(layout).map(([x, y]) => [x + shiftX, y + shiftY]),
    true,
  );
};

/**
 * Replaces the straight `<text>` lines of a rendered label with `<textPath>`s
 * along the line (and parallel curves for further lines).
 *
 * @param node the label's node, whose `<text>` children carry its styling
 * @param shiftX scene -> export offset
 */
export const renderCurvedLabelSvg = (
  text: ExcalidrawTextElement,
  node: SVGElement,
  elementsMap: ElementsMap,
  sampler: PathSampler,
  shiftX: number,
  shiftY: number,
) => {
  const layout = getCurvedLabelLayout(text, elementsMap, sampler);
  if (!layout) {
    return false;
  }
  const doc = node.ownerDocument;
  const template = node.querySelector("text");
  const styling = ["font-family", "font-size", "fill", "direction"].flatMap(
    (name) => {
      const value = template?.getAttribute(name);
      return value ? [[name, value] as const] : [];
    },
  );
  node.querySelectorAll("text").forEach((child) => child.remove());
  node.setAttribute(
    "transform",
    `translate(${Math.round(shiftX * 100) / 100} ${
      Math.round(shiftY * 100) / 100
    })`,
  );

  // the path is extended past both ends so text overhanging a short line
  // still renders
  const overhang = Math.max(...layout.lines.map((line) => line.width));
  const defs = doc.createElementNS(SVG_NS, "defs");
  node.appendChild(defs);
  layout.lines.forEach((line, index) => {
    const steps = PATH_SAMPLES;
    const points: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const s = -overhang + ((layout.path.length + overhang * 2) * i) / steps;
      const p = pointAtLength(layout.path, s);
      const { nx, ny } = normalAt(p);
      points.push([p.x + nx * line.offset, p.y + ny * line.offset]);
    }
    const id = `curved-label-${text.id}-${index}`;
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("id", id);
    path.setAttribute("d", pathData(points));
    path.setAttribute("fill", "none");
    defs.appendChild(path);

    const textNode = doc.createElementNS(SVG_NS, "text");
    for (const [name, value] of styling) {
      textNode.setAttribute(name, value);
    }
    textNode.setAttribute("text-anchor", "middle");
    textNode.setAttribute("dominant-baseline", "central");
    textNode.setAttribute("style", "white-space: pre;");
    const textPath = doc.createElementNS(SVG_NS, "textPath");
    textPath.setAttribute("href", `#${id}`);
    textPath.setAttribute(
      "startOffset",
      `${Math.round((layout.center + overhang) * 100) / 100}`,
    );
    textPath.textContent = line.text;
    textNode.appendChild(textPath);
    node.appendChild(textNode);
  });
  return true;
};
