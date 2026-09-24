import { BOUND_TEXT_PADDING } from "@excalidraw/common";
import { getCurvedLabelHolePathData } from "@excalidraw/element/curvedLabel";
import {
  getBoundTextElement,
  isElbowArrow,
  LinearElementEditor,
} from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import {
  getDotAnimationSource,
  getDotCycleDuration,
  getSequenceSchedule,
  isAnimationDotCandidate,
} from "./dot";

import { getElementAnimation } from "./types";

import type { DotAnimationSource } from "./dot";

import type { Drawable } from "roughjs/bin/core";
import type { RoughSVG } from "roughjs/bin/svg";

import type { AnimatableElement, ElementAnimation } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

/** flow `alternate` travels this many dash periods before turning around */
const FLOW_ALTERNATE_PERIODS = 3;
/** fraction of a `draw` cycle during which the fully drawn line is held */
const DRAW_HOLD = 0.3;

const num = (value: number) => String(Math.round(value * 100) / 100);

const createAnimationNode = (
  doc: Document,
  tagName: "animate" | "animateMotion",
  attributes: Record<string, string>,
) => {
  const node = doc.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  node.setAttribute("repeatCount", "indefinite");
  return node;
};

/**
 * roughjs renders one child per drawable set, in order; only `path` sets
 * are strokes (the others are fills)
 */
const getStrokePaths = (node: SVGElement, drawable: Drawable) =>
  drawable.sets.flatMap((set, index) => {
    const child = node.children[index];
    return set.type === "path" && child?.tagName === "path"
      ? [child as SVGPathElement]
      : [];
  });

/**
 * A single, smooth path from the first to the last point. The rendered rough
 * strokes can't be used for this, as roughjs draws every segment (twice) as
 * a separate sub-path.
 */
const getCenterlinePath = (
  rsvg: RoughSVG,
  element: AnimatableElement,
  points: readonly (readonly [number, number])[] = element.points,
) => {
  // elbow arrows only round their corners slightly, a polyline is close enough
  if (element.roundness && !isElbowArrow(element) && points.length > 2) {
    const curve = rsvg.generator.curve(
      points as unknown as [number, number][],
      {
        roughness: 0,
        disableMultiStroke: true,
      },
    );
    return rsvg.opsToPath(curve.sets[0], 2);
  }
  return points
    .map(([x, y], index) => `${index ? "L" : "M"}${num(x)} ${num(y)}`)
    .join(" ");
};

const getPointsBounds = (element: AnimatableElement, padding: number) => {
  const xs = element.points.map((point) => point[0]);
  const ys = element.points.map((point) => point[1]);
  const x = Math.min(...xs) - padding;
  const y = Math.min(...ys) - padding;
  return {
    x,
    y,
    width: Math.max(...xs) + padding - x,
    height: Math.max(...ys) + padding - y,
  };
};

const applyFlow = (path: SVGPathElement, animation: ElementAnimation) => {
  const { dashLength, gapLength, direction, duration } = animation;
  const period = dashLength + gapLength;
  path.setAttribute("stroke-dasharray", `${num(dashLength)} ${num(gapLength)}`);
  path.setAttribute("stroke-dashoffset", "0");

  // decreasing the offset moves the dashes towards the end of the path
  const attributes: Record<string, string> =
    direction === "alternate"
      ? {
          values: `0;${num(-period * FLOW_ALTERNATE_PERIODS)};0`,
          dur: `${num(duration * FLOW_ALTERNATE_PERIODS * 2)}ms`,
        }
      : {
          values: `0;${num(direction === "forward" ? -period : period)}`,
          dur: `${num(duration)}ms`,
        };

  path.appendChild(
    createAnimationNode(path.ownerDocument, "animate", {
      attributeName: "stroke-dashoffset",
      calcMode: "linear",
      ...attributes,
    }),
  );
};

const applyPulse = (path: SVGPathElement, animation: ElementAnimation) => {
  path.appendChild(
    createAnimationNode(path.ownerDocument, "animate", {
      attributeName: "opacity",
      values: "1;0.25;1",
      keyTimes: "0;0.5;1",
      calcMode: "spline",
      keySplines: "0.4 0 0.6 1;0.4 0 0.6 1",
      dur: `${num(animation.duration)}ms`,
    }),
  );
};

/**
 * Reveals the curve through a mask whose centerline stroke is drawn in, so
 * the rough stroke style (sloppiness, dashes) is preserved. Arrowheads fade
 * in once the line is complete.
 */
const applyDraw = (
  curveNode: SVGElement,
  arrowheadNodes: SVGElement[],
  centerline: string,
  element: AnimatableElement,
  animation: ElementAnimation,
) => {
  const doc = curveNode.ownerDocument;
  const maskStrokeWidth = element.strokeWidth * 3 + 12;
  const bounds = getPointsBounds(element, maskStrokeWidth);

  const mask = doc.createElementNS(SVG_NS, "mask");
  const maskId = `animation-draw-${element.id}`;
  mask.setAttribute("id", maskId);
  // userSpaceOnUse: a zero-height bbox (horizontal line) would hide everything
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("x", num(bounds.x));
  mask.setAttribute("y", num(bounds.y));
  mask.setAttribute("width", num(bounds.width));
  mask.setAttribute("height", num(bounds.height));

  const reveal = doc.createElementNS(SVG_NS, "path");
  reveal.setAttribute("d", centerline);
  reveal.setAttribute("fill", "none");
  reveal.setAttribute("stroke", "#fff");
  reveal.setAttribute("stroke-width", num(maskStrokeWidth));
  reveal.setAttribute("stroke-linecap", "round");
  reveal.setAttribute("stroke-linejoin", "round");
  reveal.setAttribute("pathLength", "1");
  reveal.setAttribute("stroke-dasharray", "1 1");
  // static renderers without SMIL support show the full line
  reveal.setAttribute("stroke-dashoffset", "0");

  // with a "1 1" pattern over a normalized length, offset 1 hides the line,
  // 0 shows it fully, and -1 hides it again (erasing from the start); a
  // negative offset grows the visible part from the end
  const drawEnd = 1 - DRAW_HOLD;
  let values: string[];
  let keyTimes: number[];
  let arrowheadValues: string[];
  let arrowheadKeyTimes: number[];
  if (animation.direction === "alternate") {
    values = ["1", "0", "0", "-1"];
    keyTimes = [0, 0.4, 0.6, 1];
    arrowheadValues = ["0", "0", "1", "1", "0", "0"];
    arrowheadKeyTimes = [0, 0.38, 0.4, 0.6, 0.62, 1];
  } else {
    values = [animation.direction === "forward" ? "1" : "-1", "0", "0"];
    keyTimes = [0, drawEnd, 1];
    arrowheadValues = ["0", "0", "1", "1"];
    arrowheadKeyTimes = [0, drawEnd - 0.02, drawEnd, 1];
  }
  const dur = `${num(animation.duration)}ms`;

  reveal.appendChild(
    createAnimationNode(doc, "animate", {
      attributeName: "stroke-dashoffset",
      values: values.join(";"),
      keyTimes: keyTimes.map(num).join(";"),
      calcMode: "linear",
      dur,
    }),
  );
  mask.appendChild(reveal);

  const masked = doc.createElementNS(SVG_NS, "g");
  masked.setAttribute("mask", `url(#${maskId})`);
  while (curveNode.firstChild) {
    masked.appendChild(curveNode.firstChild);
  }
  curveNode.appendChild(mask);
  curveNode.appendChild(masked);

  arrowheadNodes.forEach((node) => {
    node.appendChild(
      createAnimationNode(doc, "animate", {
        attributeName: "opacity",
        values: arrowheadValues.join(";"),
        keyTimes: arrowheadKeyTimes.map(num).join(";"),
        calcMode: "linear",
        dur,
      }),
    );
  });
};

/**
 * Adds SMIL animations to a rendered linear element, if it has any configured.
 *
 * @param shapes the element's rough.js shapes: the curve first, then
 *               arrowheads
 * @param group contains exactly one rendered node per shape, in order
 */
export const applyElementAnimation = (
  rsvg: RoughSVG,
  element: ExcalidrawElement,
  shapes: readonly Drawable[],
  group: SVGElement,
) => {
  const animation = getElementAnimation(element);
  if (!animation) {
    return;
  }
  const animatable = element as AnimatableElement;
  const [curveNode, ...arrowheadNodes] = [...group.children] as SVGElement[];
  if (!curveNode || !shapes[0]) {
    return;
  }
  const strokePaths = getStrokePaths(curveNode, shapes[0]);
  if (!strokePaths.length) {
    return;
  }
  switch (animation.type) {
    case "flow":
      strokePaths.forEach((path) => applyFlow(path, animation));
      break;
    case "pulse":
      strokePaths.forEach((path) => applyPulse(path, animation));
      break;
    case "draw":
      applyDraw(
        curveNode,
        arrowheadNodes,
        getCenterlinePath(rsvg, animatable),
        animatable,
        animation,
      );
      break;
    case "dot":
      // animated through the dot element itself, see applyAnimationDotMotion
      break;
  }
};

/**
 * Timing of one dot: its own looping cycle, or its window within the shared
 * timeline of sequenced lines (hidden outside of it). Several dots on a line
 * are spread evenly by phase-shifting them with a negative `begin`, so they
 * are in place from the first frame.
 */
const getDotTiming = (
  { line, animation, index, count }: DotAnimationSource,
  elementsMap: ElementsMap,
) => {
  const cycle = getDotCycleDuration(animation);
  const schedule = animation.sequence ? getSequenceSchedule(elementsMap) : null;
  const start = schedule?.starts.get(line.id);
  const total = start !== undefined ? schedule!.total : cycle;

  // fractions of `total` where this line's cycle starts and ends
  const from = start !== undefined ? start / total : 0;
  const to = start !== undefined ? (start + cycle) / total : 1;
  const sequenced = start !== undefined;
  const alternate = animation.direction === "alternate";
  const travel = alternate
    ? ["0", "1", "0"]
    : animation.direction === "forward"
    ? ["0", "1"]
    : ["1", "0"];
  // sequenced: hold the start point before this line's turn, the end after
  const points = sequenced
    ? [travel[0], ...travel, travel[travel.length - 1]]
    : travel;
  const times = sequenced
    ? alternate
      ? [0, from, (from + to) / 2, to, 1]
      : [0, from, to, 1]
    : alternate
    ? [0, 0.5, 1]
    : [0, 1];

  const delay = (index * cycle) / count;
  return {
    keyPoints: points.join(";"),
    keyTimes: times.map(num).join(";"),
    dur: `${num(total)}ms`,
    begin: (delay ? { begin: `${num(delay - total)}ms` } : {}) as Record<
      string,
      string
    >,
    visibility:
      sequenced && (from > 0 || to < 1)
        ? [0, from, to].map(num).join(";")
        : null,
  };
};

export const getDotMaskId = (dotId: string) => `animation-dot-mask-${dotId}`;

/**
 * Moves a "moving dot" element along its line. The dot's static position
 * stays as drawn, for renderers without SMIL support.
 *
 * Structure, so the label hole stays put while the dot moves:
 *
 *   node (dot transform, mask = hole around the line's label)
 *     g (animateMotion)
 *       ...dot shapes
 *
 * @param offsetX export x of the dot (as used in the node's transform)
 * @param offsetY export y of the dot
 */
export const applyAnimationDotMotion = (
  rsvg: RoughSVG,
  element: ExcalidrawElement,
  node: SVGElement,
  elementsMap: ElementsMap,
  offsetX: number,
  offsetY: number,
) => {
  if (!isAnimationDotCandidate(element)) {
    return;
  }
  const source = getDotAnimationSource(element, elementsMap);
  if (!source) {
    return;
  }
  const { line } = source;
  const doc = node.ownerDocument;

  // the node is rotated around the dot center, so its local frame is too
  const cx = element.width / 2;
  const cy = element.height / 2;
  const degree = (180 * element.angle) / Math.PI;
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);

  // animateMotion translates in the node's local frame, so the path is the
  // line relative to the dot center, rotated back by the dot's angle
  const centerX = element.x + cx;
  const centerY = element.y + cy;
  const points = LinearElementEditor.getPointsGlobalCoordinates(
    line,
    elementsMap,
  ).map(([x, y]) => {
    const dx = x - centerX;
    const dy = y - centerY;
    return [dx * cos - dy * sin, dx * sin + dy * cos] as const;
  });

  const timing = getDotTiming(source, elementsMap);

  const moving = doc.createElementNS(SVG_NS, "g");
  while (node.firstChild) {
    moving.appendChild(node.firstChild);
  }
  moving.appendChild(
    createAnimationNode(doc, "animateMotion", {
      path: getCenterlinePath(rsvg, line, points),
      calcMode: "linear",
      keyPoints: timing.keyPoints,
      keyTimes: timing.keyTimes,
      dur: timing.dur,
      ...timing.begin,
    }),
  );
  if (timing.visibility) {
    moving.appendChild(
      createAnimationNode(doc, "animate", {
        attributeName: "opacity",
        calcMode: "discrete",
        values: "0;1;0",
        keyTimes: timing.visibility,
        dur: timing.dur,
        ...timing.begin,
      }),
    );
  }

  // same hole the line gets around its label, so the dot passes under it
  const label = getBoundTextElement(line, elementsMap);
  if (label) {
    const { x, y } = LinearElementEditor.getBoundTextElementPosition(
      line,
      label,
      elementsMap,
    );
    const maskId = getDotMaskId(element.id);
    const mask = doc.createElementNS(SVG_NS, "mask");
    mask.setAttribute("id", maskId);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("x", "-100000");
    mask.setAttribute("y", "-100000");
    mask.setAttribute("width", "200000");
    mask.setAttribute("height", "200000");

    const visible = doc.createElementNS(SVG_NS, "rect");
    visible.setAttribute("x", "-100000");
    visible.setAttribute("y", "-100000");
    visible.setAttribute("width", "200000");
    visible.setAttribute("height", "200000");
    visible.setAttribute("fill", "#fff");

    // hole in export coordinates, mapped into the node's local frame by
    // undoing the node's transform
    // curved labels cut a band along the line instead of a box
    const curvedHole = getCurvedLabelHolePathData(
      label,
      elementsMap,
      LinearElementEditor.getPointAtPathParameter,
      offsetX - element.x,
      offsetY - element.y,
    );
    const hole = doc.createElementNS(SVG_NS, curvedHole ? "path" : "rect");
    if (curvedHole) {
      hole.setAttribute("d", curvedHole);
    } else {
      hole.setAttribute("x", num(x - element.x + offsetX - BOUND_TEXT_PADDING));
      hole.setAttribute("y", num(y - element.y + offsetY - BOUND_TEXT_PADDING));
      hole.setAttribute("width", num(label.width + BOUND_TEXT_PADDING * 2));
      hole.setAttribute("height", num(label.height + BOUND_TEXT_PADDING * 2));
    }
    hole.setAttribute("fill", "#000");
    hole.setAttribute(
      "transform",
      `rotate(${num(-degree)} ${num(cx)} ${num(cy)}) translate(${num(
        -offsetX,
      )} ${num(-offsetY)})`,
    );

    mask.appendChild(visible);
    mask.appendChild(hole);
    node.appendChild(mask);
    node.setAttribute("mask", `url(#${maskId})`);
  }
  node.appendChild(moving);
};
