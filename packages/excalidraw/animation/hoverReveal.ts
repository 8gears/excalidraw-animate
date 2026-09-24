import { getBoundTextElement, getContainerElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { getAnimationDot, isLineAnimated } from "./dot";
import { getDotMaskId } from "./svg";
import { isAnimatableElement } from "./types";

/**
 * "Hover reveal": text in the exported SVG stays hidden until the pointer is
 * over the image. Pure CSS, so it only works where the SVG is interactive
 * (inline or via <object>/<iframe>), not in an <img>.
 */
export const HOVER_REVEAL_MODES = ["off", "all", "animated"] as const;
export type HoverRevealMode = typeof HOVER_REVEAL_MODES[number];

const ANIMATED_LABEL_CLASS = "ea-animated-label";
const ROOT_CLASS = "ea-hover-reveal";

/**
 * Tags labels of animated lines so export options can target them with CSS.
 * Other text stays untouched, keeping exports of non-animated scenes
 * byte-identical to upstream.
 */
export const markTextNode = (
  element: ExcalidrawTextElement,
  node: SVGElement,
  elementsMap: ElementsMap,
) => {
  const container = getContainerElement(element, elementsMap);
  if (container && isLineAnimated(container, elementsMap)) {
    node.classList.add(ANIMATED_LABEL_CLASS);
  }
};

/** labelled lines whose label is hidden while not hovering */
const getHiddenLabelLines = (
  mode: Exclude<HoverRevealMode, "off">,
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
) =>
  elements.filter(
    (element) =>
      isAnimatableElement(element) &&
      getBoundTextElement(element, elementsMap) &&
      (mode === "all" || isLineAnimated(element, elementsMap)),
  );

export const applyHoverReveal = (
  svg: SVGSVGElement,
  mode: HoverRevealMode,
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  if (mode === "off") {
    return svg;
  }
  const text = mode === "all" ? "text" : `.${ANIMATED_LABEL_CLASS}`;
  // scoped to this SVG's root, which matters once it's inlined into a page
  const hidden = `.${ROOT_CLASS}:not(:hover)`;
  const rules = [
    `.${ROOT_CLASS} ${text}{transition:opacity .25s ease-in-out}`,
    `${hidden} ${text}{opacity:0}`,
  ];

  // a label cuts a gap into its line (via a mask), close it while hidden
  const masks = getHiddenLabelLines(mode, elements, elementsMap)
    .flatMap((line) => {
      const dot = getAnimationDot(line, elementsMap);
      return [`mask-${line.id}`, ...(dot ? [getDotMaskId(dot.id)] : [])];
    })
    .filter((id) => svg.querySelector(`[mask="url(#${id})"]`))
    .map((id) => `[mask="url(#${id})"]`);
  if (masks.length) {
    rules.push(`${hidden} :is(${masks.join(",")}){mask:none}`);
  }

  svg.classList.add(ROOT_CLASS);
  const style = svg.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "style",
  );
  style.textContent = rules.join("");
  svg.insertBefore(style, svg.firstChild);
  return svg;
};
