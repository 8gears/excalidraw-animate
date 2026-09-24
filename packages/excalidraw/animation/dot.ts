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
 *   line.customData.animation = { type: "dot", dotIds: [...] }
 *   dot.customData.animationDot = { arrowId }
 *
 * The link only counts when both sides agree, so a deleted dot or a copy of
 * just one side drops out (all dots gone disables the animation) instead of
 * cross-wiring elements.
 */
export const ANIMATION_DOT_CUSTOM_DATA_KEY = "animationDot";

const getLinkedLineId = (element: ExcalidrawElement): string | null => {
  const arrowId = element.customData?.[ANIMATION_DOT_CUSTOM_DATA_KEY]?.arrowId;
  return typeof arrowId === "string" ? arrowId : null;
};

export const isAnimationDotCandidate = (element: ExcalidrawElement) =>
  getLinkedLineId(element) !== null;

/** the line's dots that still exist, in their animation order */
export const getAnimationDots = (
  line: ExcalidrawElement,
  elementsMap: ElementsMap,
): NonDeletedExcalidrawElement[] => {
  const animation = getElementAnimation(line);
  if (animation?.type !== "dot") {
    return [];
  }
  return (animation.dotIds ?? []).flatMap((id) => {
    const dot = elementsMap.get(id);
    return dot && !dot.isDeleted && getLinkedLineId(dot) === line.id
      ? [dot as NonDeletedExcalidrawElement]
      : [];
  });
};

export type DotAnimationSource = {
  line: AnimatableElement;
  animation: ElementAnimation;
  /** position of this dot among the line's dots */
  index: number;
  count: number;
};

/** the line (and its animation) a dot moves along */
export const getDotAnimationSource = (
  dot: ExcalidrawElement,
  elementsMap: ElementsMap,
): DotAnimationSource | null => {
  const lineId = getLinkedLineId(dot);
  const line = lineId ? elementsMap.get(lineId) : null;
  if (!line || line.isDeleted || !isAnimatableElement(line)) {
    return null;
  }
  const dots = getAnimationDots(line, elementsMap);
  const index = dots.findIndex((candidate) => candidate.id === dot.id);
  if (index < 0) {
    return null;
  }
  return {
    line,
    animation: getElementAnimation(line)!,
    index,
    count: dots.length,
  };
};

/** one full animation cycle, a back-and-forth counts as one */
export const getDotCycleDuration = (animation: ElementAnimation) =>
  animation.direction === "alternate"
    ? animation.duration * 2
    : animation.duration;

export type SequenceSchedule = {
  /** length of the shared timeline in ms */
  total: number;
  /** start of each sequenced line within the timeline, in ms */
  starts: Map<string, number>;
};

/**
 * Lines with a sequence number share one looping timeline: steps play one
 * after another in ascending order, lines of the same step together. A step
 * lasts as long as its slowest line.
 */
export const getSequenceSchedule = (
  elementsMap: ElementsMap,
): SequenceSchedule => {
  const steps = new Map<number, { lineId: string; cycle: number }[]>();
  for (const element of elementsMap.values()) {
    const animation = getElementAnimation(element);
    if (
      animation?.type !== "dot" ||
      !animation.sequence ||
      element.isDeleted ||
      !getAnimationDots(element, elementsMap).length
    ) {
      continue;
    }
    const step = steps.get(animation.sequence) ?? [];
    step.push({ lineId: element.id, cycle: getDotCycleDuration(animation) });
    steps.set(animation.sequence, step);
  }
  const starts = new Map<string, number>();
  let total = 0;
  for (const sequence of [...steps.keys()].sort((a, b) => a - b)) {
    const step = steps.get(sequence)!;
    for (const { lineId } of step) {
      starts.set(lineId, total);
    }
    total += Math.max(...step.map(({ cycle }) => cycle));
  }
  return { total, starts };
};

/** point at `fraction` of the polyline through the line's points */
const getPointAlongLine = (
  line: AnimatableElement,
  fraction: number,
  elementsMap: ElementsMap,
): readonly [number, number] => {
  const points = LinearElementEditor.getPointsGlobalCoordinates(
    line,
    elementsMap,
  );
  const lengths = points
    .slice(1)
    .map((point, i) =>
      Math.hypot(point[0] - points[i][0], point[1] - points[i][1]),
    );
  let remaining = lengths.reduce((a, b) => a + b, 0) * fraction;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? Math.min(1, remaining / lengths[i]) : 0;
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ];
    }
    remaining -= lengths[i];
  }
  return [points[0][0], points[0][1]];
};

/**
 * A dot on the line, at `fraction` of the way from where the animation
 * starts. Styled like `template` (an existing dot) if given, so added dots
 * match the ones the user already styled.
 */
export const createAnimationDot = (
  line: AnimatableElement,
  direction: ElementAnimation["direction"],
  elementsMap: ElementsMap,
  fraction = 0,
  template?: ExcalidrawElement | null,
) => {
  const [x, y] = getPointAlongLine(
    line,
    direction === "reverse" ? 1 - fraction : fraction,
    elementsMap,
  );
  const size = Math.max(10, line.strokeWidth * 5);
  const width = template?.width ?? size;
  const height = template?.height ?? size;
  const style = template
    ? {
        strokeColor: template.strokeColor,
        backgroundColor: template.backgroundColor,
        fillStyle: template.fillStyle,
        strokeWidth: template.strokeWidth,
        strokeStyle: template.strokeStyle,
        roughness: template.roughness,
        opacity: template.opacity,
        roundness: template.roundness,
      }
    : {
        strokeColor: line.strokeColor,
        backgroundColor: line.strokeColor,
        fillStyle: "solid" as const,
        strokeWidth: 1,
        strokeStyle: "solid" as const,
        roughness: 0,
        opacity: line.opacity,
        roundness: null,
      };
  return newElement({
    type:
      template &&
      (template.type === "rectangle" ||
        template.type === "diamond" ||
        template.type === "ellipse")
        ? template.type
        : "ellipse",
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
    ...style,
    frameId: line.frameId,
    groupIds: line.groupIds,
    customData: { [ANIMATION_DOT_CUSTOM_DATA_KEY]: { arrowId: line.id } },
  });
};

/**
 * Position along the direction of travel, used to number lines "left to
 * right": where the dots start on the line.
 */
export const getTravelStart = (
  line: AnimatableElement,
  elementsMap: ElementsMap,
) => {
  const animation = getElementAnimation(line);
  return getPointAlongLine(
    line,
    animation?.direction === "reverse" ? 1 : 0,
    elementsMap,
  );
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
    if (animation?.type === "dot" && animation.dotIds?.length) {
      const dotIds = animation.dotIds.map(
        (id) => origIdToDuplicateId.get(id) ?? id,
      );
      if (dotIds.some((id, i) => id !== animation.dotIds![i])) {
        changed = true;
        return {
          ...element,
          customData: {
            ...element.customData,
            [ANIMATION_CUSTOM_DATA_KEY]: { ...animation, dotIds },
          },
        };
      }
    }
    return element;
  });
  return changed ? result : undefined;
};

/** configured, and for dots: at least one dot still exists */
export const isLineAnimated = (
  line: ExcalidrawElement,
  elementsMap: ElementsMap,
) => {
  const animation = getElementAnimation(line);
  return (
    !!animation &&
    (animation.type !== "dot" || getAnimationDots(line, elementsMap).length > 0)
  );
};
