import { LinearElementEditor, newElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { OnDuplicateData } from "@excalidraw/element";

import {
  ANIMATION_CUSTOM_DATA_KEY,
  getElementAnimation,
  isAnimatableElement,
} from "./types";

import type { AnimatableElement, ElementAnimation } from "./types";

/**
 * A "moving dot" is a regular canvas element (so it can be styled like any
 * other) linked both ways with its line:
 *
 *   line.customData.animation = { type: "dot", dotId }
 *   dot.customData.animationDot = { arrowId }
 *
 * The link only counts when both sides agree, so a deleted dot or a copy of
 * just one side disables the animation instead of cross-wiring elements.
 */
export const ANIMATION_DOT_CUSTOM_DATA_KEY = "animationDot";

const getLinkedLineId = (element: ExcalidrawElement): string | null => {
  const arrowId = element.customData?.[ANIMATION_DOT_CUSTOM_DATA_KEY]?.arrowId;
  return typeof arrowId === "string" ? arrowId : null;
};

export const isAnimationDotCandidate = (element: ExcalidrawElement) =>
  getLinkedLineId(element) !== null;

/** the line's dot, if the line animates a dot and the dot still exists */
export const getAnimationDot = (
  line: ExcalidrawElement,
  elementsMap: ElementsMap,
): NonDeletedExcalidrawElement | null => {
  const animation = getElementAnimation(line);
  if (animation?.type !== "dot" || !animation.dotId) {
    return null;
  }
  const dot = elementsMap.get(animation.dotId);
  if (!dot || dot.isDeleted || getLinkedLineId(dot) !== line.id) {
    return null;
  }
  return dot as NonDeletedExcalidrawElement;
};

/** the line (and its animation) a dot moves along */
export const getDotAnimationSource = (
  dot: ExcalidrawElement,
  elementsMap: ElementsMap,
): { line: AnimatableElement; animation: ElementAnimation } | null => {
  const lineId = getLinkedLineId(dot);
  const line = lineId ? elementsMap.get(lineId) : null;
  if (
    !line ||
    line.isDeleted ||
    !isAnimatableElement(line) ||
    getAnimationDot(line, elementsMap)?.id !== dot.id
  ) {
    return null;
  }
  return { line, animation: getElementAnimation(line)! };
};

/** a small filled circle on the point the animation starts from */
export const createAnimationDot = (
  line: AnimatableElement,
  direction: ElementAnimation["direction"],
  elementsMap: ElementsMap,
) => {
  const [x, y] = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    line,
    direction === "reverse" ? -1 : 0,
    elementsMap,
  );
  const size = Math.max(10, line.strokeWidth * 5);
  return newElement({
    type: "ellipse",
    x: x - size / 2,
    y: y - size / 2,
    width: size,
    height: size,
    strokeColor: line.strokeColor,
    backgroundColor: line.strokeColor,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: line.opacity,
    roundness: null,
    frameId: line.frameId,
    groupIds: line.groupIds,
    customData: { [ANIMATION_DOT_CUSTOM_DATA_KEY]: { arrowId: line.id } },
  });
};

/**
 * `onDuplicate` handler (pass it to `<Excalidraw onDuplicate>`): re-links
 * copied line/dot pairs to each other instead of to the originals.
 */
export const remapAnimationReferences = (
  nextElements: readonly ExcalidrawElement[],
  _prevElements: readonly ExcalidrawElement[],
  { duplicateElements, origIdToDuplicateId }: OnDuplicateData,
): ExcalidrawElement[] | void => {
  let changed = false;
  const result = nextElements.map((element) => {
    if (!duplicateElements.has(element.id)) {
      return element;
    }
    const lineId = getLinkedLineId(element);
    if (lineId) {
      const nextLineId = origIdToDuplicateId.get(lineId);
      if (nextLineId) {
        changed = true;
        return {
          ...element,
          customData: {
            ...element.customData,
            [ANIMATION_DOT_CUSTOM_DATA_KEY]: { arrowId: nextLineId },
          },
        };
      }
      return element;
    }
    const animation = getElementAnimation(element);
    if (animation?.type === "dot" && animation.dotId) {
      const nextDotId = origIdToDuplicateId.get(animation.dotId);
      if (nextDotId) {
        changed = true;
        return {
          ...element,
          customData: {
            ...element.customData,
            [ANIMATION_CUSTOM_DATA_KEY]: { ...animation, dotId: nextDotId },
          },
        };
      }
    }
    return element;
  });
  return changed ? result : undefined;
};

/** configured, and for dots: the dot still exists */
export const isLineAnimated = (
  line: ExcalidrawElement,
  elementsMap: ElementsMap,
) => {
  const animation = getElementAnimation(line);
  return (
    !!animation &&
    (animation.type !== "dot" || !!getAnimationDot(line, elementsMap))
  );
};
