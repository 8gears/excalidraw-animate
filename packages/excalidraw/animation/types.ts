import { isArrowElement, isLineElement } from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawLineElement,
} from "@excalidraw/element/types";

export const ANIMATION_CUSTOM_DATA_KEY = "animation";

export const ANIMATION_TYPES = ["flow", "draw", "pulse", "dot"] as const;
export type ElementAnimationType = typeof ANIMATION_TYPES[number];

export const ANIMATION_DIRECTIONS = [
  "forward",
  "reverse",
  "alternate",
] as const;
export type ElementAnimationDirection = typeof ANIMATION_DIRECTIONS[number];

export type ElementAnimation = {
  type: ElementAnimationType;
  /** relative to the element's points order (start -> end) */
  direction: ElementAnimationDirection;
  /** duration of one animation cycle in ms */
  duration: number;
  /** used by `flow` */
  dashLength: number;
  /** used by `flow` */
  gapLength: number;
  /** used by `dot`: id of the canvas element that moves along the line */
  dotId?: string;
};

export type AnimatableElement = ExcalidrawArrowElement | ExcalidrawLineElement;

export const ANIMATION_LIMITS = {
  duration: { min: 100, max: 20000, step: 100 },
  dashLength: { min: 1, max: 200, step: 1 },
  gapLength: { min: 1, max: 200, step: 1 },
} as const;

const DEFAULT_DURATION: Record<ElementAnimationType, number> = {
  flow: 1000,
  draw: 2000,
  pulse: 1500,
  dot: 2000,
};

export const isAnimatableElement = (
  element: ExcalidrawElement | null | undefined,
): element is AnimatableElement =>
  !!element && (isArrowElement(element) || isLineElement(element));

const clamp = (value: unknown, limits: { min: number; max: number }) => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.min(limits.max, Math.max(limits.min, num));
};

/** returns a validated animation config, or null if none/invalid */
export const getElementAnimation = (
  element: ExcalidrawElement,
): ElementAnimation | null => {
  if (!isAnimatableElement(element)) {
    return null;
  }
  const raw = element.customData?.[ANIMATION_CUSTOM_DATA_KEY];
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (!ANIMATION_TYPES.includes(raw.type)) {
    return null;
  }
  const defaults = getDefaultAnimation(element, raw.type);
  return {
    type: raw.type,
    direction: ANIMATION_DIRECTIONS.includes(raw.direction)
      ? raw.direction
      : defaults.direction,
    duration:
      clamp(raw.duration, ANIMATION_LIMITS.duration) ?? defaults.duration,
    dashLength:
      clamp(raw.dashLength, ANIMATION_LIMITS.dashLength) ?? defaults.dashLength,
    gapLength:
      clamp(raw.gapLength, ANIMATION_LIMITS.gapLength) ?? defaults.gapLength,
    ...(raw.type === "dot" && typeof raw.dotId === "string"
      ? { dotId: raw.dotId }
      : {}),
  };
};

export const getDefaultAnimation = (
  element: AnimatableElement,
  type: ElementAnimationType,
): ElementAnimation => {
  let direction: ElementAnimationDirection = "forward";
  if (isArrowElement(element)) {
    if (element.startArrowhead && element.endArrowhead) {
      direction = "alternate";
    } else if (element.startArrowhead) {
      direction = "reverse";
    }
  }
  const dashLength = Math.max(8, Math.round(element.strokeWidth * 4));
  return {
    type,
    direction,
    duration: DEFAULT_DURATION[type],
    dashLength,
    gapLength: Math.round(dashLength * 0.6),
  };
};

export const withElementAnimation = (
  element: AnimatableElement,
  animation: ElementAnimation | null,
): NonNullable<ExcalidrawElement["customData"]> => {
  const { [ANIMATION_CUSTOM_DATA_KEY]: _, ...rest } = element.customData ?? {};
  // `undefined` would be skipped by `newElementWith`, leaving the old value
  if (!animation) {
    return rest;
  }
  return { ...rest, [ANIMATION_CUSTOM_DATA_KEY]: animation };
};
