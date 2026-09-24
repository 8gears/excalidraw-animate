import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  getBoundTextElement,
  getCommonBounds,
  isArrowElement,
  LinearElementEditor,
  newElementWith,
} from "@excalidraw/element";

import {
  isLabelFollowingPath,
  LABEL_FOLLOWS_PATH_CUSTOM_DATA_KEY,
} from "@excalidraw/element/curvedLabel";
import {
  getClearLabelOffset,
  getLabelOffset,
  LABEL_OFFSET_CUSTOM_DATA_KEY,
} from "@excalidraw/element/labelOffset";

import type {
  ExcalidrawElement,
  ExcalidrawTextElementWithContainer,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  useApp,
  useExcalidrawElements,
  useExcalidrawSetAppState,
} from "../components/App";
import { useUIAppState } from "../context/ui-appState";

import { AnimationPreviewDialog } from "./AnimationPreviewDialog";
import { createAnimationDot, getAnimationDots, getTravelStart } from "./dot";
import { DIRECTION_LABELS, STRINGS, TYPE_LABELS } from "./strings";
import {
  ANIMATION_DIRECTIONS,
  ANIMATION_LIMITS,
  ANIMATION_TYPES,
  getDefaultAnimation,
  getElementAnimation,
  isAnimatableElement,
  withElementAnimation,
} from "./types";

import "./AnimationMenu.scss";

import type {
  AnimatableElement,
  ElementAnimation,
  ElementAnimationType,
} from "./types";

type Filter = "all" | "animated" | "selected";

type Item = {
  element: AnimatableElement;
  label: string;
  animation: ElementAnimation | null;
  /** for `dot` animations: the dot elements that still exist */
  dots: NonDeletedExcalidrawElement[];
  labelElement: ExcalidrawTextElementWithContainer | null;
};

type LabelSide = "above" | "on" | "below";

const LABEL_MAX_LENGTH = 32;

const NumberField = ({
  label,
  value,
  limits,
  onCommit,
}: {
  label: string;
  value: number;
  limits: { min: number; max: number; step: number };
  onCommit: (value: number) => void;
}) => {
  // commit on blur/enter only, so typing doesn't flood the undo history
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(next) || next === value) {
      setDraft(String(value));
      return;
    }
    onCommit(Math.min(limits.max, Math.max(limits.min, next)));
  };

  return (
    <label className="animation-menu__field">
      <span>{label}</span>
      <input
        type="number"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          }
        }}
      />
    </label>
  );
};

const AnimationItem = ({
  item,
  selected,
  onFocus,
  onChange,
  onSelectDots,
  onLabelSide,
  onLabelFollowsPath,
}: {
  item: Item;
  selected: boolean;
  onFocus: () => void;
  onChange: (animation: ElementAnimation | null, dotCount?: number) => void;
  onSelectDots: () => void;
  onLabelSide: (side: LabelSide) => void;
  onLabelFollowsPath: (follows: boolean) => void;
}) => {
  const { element, label, animation, dots } = item;
  const isDotMissing = animation?.type === "dot" && !dots.length;

  const setType = (type: ElementAnimationType | "none") => {
    if (type === "none") {
      onChange(null);
    } else {
      // keep the user's tuning when switching between types
      onChange({
        ...getDefaultAnimation(element, type),
        ...(animation
          ? {
              direction: animation.direction,
              dashLength: animation.dashLength,
              gapLength: animation.gapLength,
              ...(type === "dot" && animation.sequence
                ? { sequence: animation.sequence }
                : {}),
            }
          : {}),
      });
    }
  };

  return (
    <li
      data-element-id={element.id}
      className={clsx("animation-menu__item", {
        "animation-menu__item--selected": selected,
        "animation-menu__item--animated": !!animation && !isDotMissing,
      })}
    >
      <div className="animation-menu__item-header">
        <button
          type="button"
          className="animation-menu__item-label"
          title={STRINGS.focus}
          onClick={onFocus}
        >
          <span
            className="animation-menu__swatch"
            style={{ backgroundColor: element.strokeColor }}
          />
          <span className="animation-menu__item-text">{label}</span>
        </button>
        <select
          aria-label={STRINGS.animation}
          value={animation?.type ?? "none"}
          onChange={(event) =>
            setType(event.target.value as ElementAnimationType | "none")
          }
        >
          {(["none", ...ANIMATION_TYPES] as const).map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      {animation && (
        <div className="animation-menu__item-controls">
          {animation.type !== "pulse" && (
            <label className="animation-menu__field">
              <span>{STRINGS.direction}</span>
              <select
                value={animation.direction}
                onChange={(event) =>
                  onChange({
                    ...animation,
                    direction: event.target
                      .value as ElementAnimation["direction"],
                  })
                }
              >
                {ANIMATION_DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>
                    {DIRECTION_LABELS[direction]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <NumberField
            label={STRINGS.duration}
            value={animation.duration}
            limits={ANIMATION_LIMITS.duration}
            onCommit={(duration) => onChange({ ...animation, duration })}
          />
          {animation.type === "flow" && (
            <>
              <NumberField
                label={STRINGS.dash}
                value={animation.dashLength}
                limits={ANIMATION_LIMITS.dashLength}
                onCommit={(dashLength) =>
                  onChange({ ...animation, dashLength })
                }
              />
              <NumberField
                label={STRINGS.gap}
                value={animation.gapLength}
                limits={ANIMATION_LIMITS.gapLength}
                onCommit={(gapLength) => onChange({ ...animation, gapLength })}
              />
            </>
          )}
          {animation.type === "dot" && (
            <>
              <NumberField
                label={STRINGS.dotCount}
                value={Math.max(1, dots.length)}
                limits={ANIMATION_LIMITS.dotCount}
                onCommit={(count) => onChange(animation, count)}
              />
              {dots.length ? (
                <button
                  type="button"
                  className="animation-menu__secondary animation-menu__wide"
                  onClick={onSelectDots}
                >
                  {dots.length > 1 ? STRINGS.selectDots : STRINGS.selectDot}
                </button>
              ) : (
                <div className="animation-menu__wide animation-menu__warning">
                  <span>{STRINGS.dotMissing}</span>
                  <button
                    type="button"
                    className="animation-menu__secondary"
                    onClick={() => onChange(animation, 1)}
                  >
                    {STRINGS.addDot}
                  </button>
                </div>
              )}
            </>
          )}
          {(item.labelElement || animation.type === "dot") && (
            // secondary settings, collapsed to keep the list scannable
            <details className="animation-menu__more animation-menu__wide">
              <summary>{STRINGS.moreOptions}</summary>
              <div className="animation-menu__more-content">
                {animation.type === "dot" && (
                  <NumberField
                    label={STRINGS.sequence}
                    value={animation.sequence ?? 0}
                    limits={ANIMATION_LIMITS.sequence}
                    onCommit={(sequence) =>
                      onChange({ ...animation, sequence: Math.round(sequence) })
                    }
                  />
                )}
                {item.labelElement && (
                  <div className="animation-menu__field animation-menu__wide">
                    <span>{STRINGS.labelPlacement}</span>
                    <div className="animation-menu__segmented" role="group">
                      {(["above", "on", "below"] as const).map((side) => {
                        const offset = getLabelOffset(item.labelElement!);
                        const current =
                          offset < 0 ? "above" : offset > 0 ? "below" : "on";
                        return (
                          <button
                            key={side}
                            type="button"
                            aria-pressed={current === side}
                            className={clsx("animation-menu__filter", {
                              "animation-menu__filter--active":
                                current === side,
                            })}
                            onClick={() => onLabelSide(side)}
                          >
                            {STRINGS.labelSides[side]}
                          </button>
                        );
                      })}
                    </div>
                    <label className="animation-menu__checkbox">
                      <input
                        type="checkbox"
                        checked={isLabelFollowingPath(item.labelElement)}
                        onChange={(event) =>
                          onLabelFollowsPath(event.target.checked)
                        }
                      />
                      {STRINGS.labelFollowsPath}
                    </label>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </li>
  );
};

export const AnimationMenu = () => {
  const app = useApp();
  const setAppState = useExcalidrawSetAppState();
  const elements = useExcalidrawElements();
  const { selectedElementIds } = useUIAppState();
  const [filter, setFilter] = useState<Filter>("all");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const items = useMemo(() => {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const counters = { arrow: 0, line: 0 };
    const result: Item[] = [];
    for (const element of elements) {
      if (!isAnimatableElement(element)) {
        continue;
      }
      const kind = isArrowElement(element) ? "arrow" : "line";
      counters[kind]++;
      const labelElement = getBoundTextElement(element, elementsMap);
      const text = labelElement?.text.replace(/\s+/g, " ").trim();
      result.push({
        element,
        label: text
          ? text.length > LABEL_MAX_LENGTH
            ? `${text.slice(0, LABEL_MAX_LENGTH)}…`
            : text
          : `${STRINGS[kind]} ${counters[kind]}`,
        animation: getElementAnimation(element),
        dots: getAnimationDots(element, elementsMap),
        labelElement,
      });
    }
    return result;
  }, [elements, app]);

  // selecting one of a line's dots on the canvas counts as selecting the line
  const isSelected = (item: Item) =>
    !!selectedElementIds[item.element.id] ||
    item.dots.some((dot) => selectedElementIds[dot.id]);
  const isAnimated = (item: Item) =>
    !!item.animation && (item.animation.type !== "dot" || item.dots.length > 0);

  const visibleItems = items.filter((item) =>
    filter === "animated"
      ? !!item.animation
      : filter === "selected"
      ? isSelected(item)
      : true,
  );
  const animatedCount = items.filter(isAnimated).length;

  const listRef = useRef<HTMLUListElement>(null);
  const firstSelectedId = visibleItems.find(isSelected)?.element.id;
  // keyed on the id only, so editing an item doesn't scroll the list around
  useEffect(() => {
    if (!firstSelectedId) {
      return;
    }
    const item = [...(listRef.current?.children ?? [])].find(
      (child) => (child as HTMLElement).dataset.elementId === firstSelectedId,
    );
    item?.scrollIntoView?.({ block: "nearest" });
  }, [firstSelectedId]);

  /**
   * Applies `animation` to the line and, for moving dots, adds or removes dot
   * elements to match `dotCount` (default: keep the current count, at least
   * one). A single scene update, so one undo reverts line and dots together.
   */
  const updateAnimation = (
    line: AnimatableElement,
    animation: ElementAnimation | null,
    dotCount?: number,
  ) => {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const currentDots = getAnimationDots(line, elementsMap);
    let next = animation;
    let dotsToAdd: NonDeletedExcalidrawElement[] = [];
    let dotsToRemove: NonDeletedExcalidrawElement[] = currentDots;

    if (next?.type === "dot") {
      const count = dotCount ?? Math.max(1, currentDots.length);
      const kept = currentDots.slice(0, count);
      dotsToRemove = currentDots.slice(count);
      const direction = next.direction;
      // spread along the line, styled like the first existing dot
      dotsToAdd = Array.from({ length: count - kept.length }, (_, i) =>
        createAnimationDot(
          line,
          direction,
          elementsMap,
          (kept.length + i) / count,
          kept[0],
        ),
      );
      next = { ...next, dotIds: [...kept, ...dotsToAdd].map((dot) => dot.id) };
    } else if (next) {
      const { dotIds: _, sequence: __, ...rest } = next;
      next = rest;
    }
    const removeIds = new Set(dotsToRemove.map((dot) => dot.id));

    app.api.updateScene({
      elements: app.scene.getElementsIncludingDeleted().flatMap((el) => {
        if (el.id === line.id) {
          return [
            newElementWith(el, {
              customData: withElementAnimation(line, next),
            }),
            ...dotsToAdd,
          ];
        }
        if (removeIds.has(el.id)) {
          return [newElementWith(el, { isDeleted: true })];
        }
        return [el];
      }),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const dotItems = items.filter(
    (item) => item.animation?.type === "dot" && item.dots.length > 0,
  );
  const selectedDotItems = dotItems.filter(isSelected);
  const sequencedItems = dotItems.filter((item) => item.animation?.sequence);
  // selected lines if several are selected, else everything already sequenced
  const sequenceTargets =
    selectedDotItems.length > 1 ? selectedDotItems : sequencedItems;
  const sequenceSteps = [
    ...sequencedItems
      .reduce((steps, item) => {
        const step = item.animation!.sequence!;
        steps.set(step, [...(steps.get(step) ?? []), item.label]);
        return steps;
      }, new Map<number, string[]>())
      .entries(),
  ].sort(([a], [b]) => a - b);

  /** numbers the target lines 1, 2, 3, … by where their dots start */
  const orderSequence = (order: "ltr" | "rtl" | "clear") => {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const lines = sequenceTargets
      .map((item) => ({
        line: item.element,
        start: getTravelStart(item.element, elementsMap),
      }))
      .sort((a, b) =>
        order === "rtl"
          ? b.start[0] - a.start[0] || a.start[1] - b.start[1]
          : a.start[0] - b.start[0] || a.start[1] - b.start[1],
      );
    const sequences = new Map(
      lines.map(({ line }, i) => [line.id, order === "clear" ? 0 : i + 1]),
    );
    app.api.updateScene({
      elements: app.scene.getElementsIncludingDeleted().map((el) => {
        const sequence = sequences.get(el.id);
        const animation = getElementAnimation(el);
        if (sequence === undefined || !animation || !isAnimatableElement(el)) {
          return el;
        }
        return newElementWith(el, {
          customData: withElementAnimation(el, { ...animation, sequence }),
        });
      }),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  /** moves the line's label just clear of the line, or back onto it */
  const setLabelSide = (item: Item, side: LabelSide) => {
    const text = item.labelElement;
    if (!text) {
      return;
    }
    const line = item.element;
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const pointAt = (pathParameter: number) =>
      LinearElementEditor.getPointAtPathParameter(
        line,
        pathParameter,
        elementsMap,
      );
    const offset =
      side === "on"
        ? 0
        : getClearLabelOffset(text, side, line.strokeWidth, pointAt);
    const { [LABEL_OFFSET_CUSTOM_DATA_KEY]: _, ...rest } =
      text.customData ?? {};
    const withOffset = newElementWith(text, {
      customData: offset
        ? { ...rest, [LABEL_OFFSET_CUSTOM_DATA_KEY]: offset }
        : rest,
    });
    const { x, y } = LinearElementEditor.getBoundTextElementPosition(
      line,
      withOffset,
      elementsMap,
    );
    app.api.updateScene({
      elements: app.scene
        .getElementsIncludingDeleted()
        .map((el) => (el.id === text.id ? { ...withOffset, x, y } : el)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const setLabelFollowsPath = (item: Item, follows: boolean) => {
    const text = item.labelElement;
    if (!text) {
      return;
    }
    const { [LABEL_FOLLOWS_PATH_CUSTOM_DATA_KEY]: _, ...rest } =
      text.customData ?? {};
    app.api.updateScene({
      elements: app.scene.getElementsIncludingDeleted().map((el) =>
        el.id === text.id
          ? newElementWith(el, {
              customData: follows
                ? { ...rest, [LABEL_FOLLOWS_PATH_CUSTOM_DATA_KEY]: true }
                : rest,
            })
          : el,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const focusElement = (element: ExcalidrawElement) => {
    setAppState({ selectedElementIds: { [element.id]: true } });
    app.viewport.setViewport({
      target: getCommonBounds([element]),
      fit: "scale-down",
      animation: { duration: 300 },
      offsets: { ui: true },
    });
  };

  const selectElements = (elements: readonly ExcalidrawElement[]) => {
    if (!elements.length) {
      return;
    }
    setAppState({
      selectedElementIds: Object.fromEntries(
        elements.map((element) => [element.id, true as const]),
      ),
    });
    app.viewport.setViewport({
      target: getCommonBounds(elements),
      fit: "scale-down",
      animation: { duration: 300 },
      offsets: { ui: true },
    });
  };

  return (
    <div className="animation-menu">
      <div className="animation-menu__header">
        <div className="animation-menu__summary">
          {STRINGS.summary(items.length, animatedCount)}
        </div>
        <div className="animation-menu__filters" role="group">
          {(
            [
              ["all", STRINGS.filterAll],
              ["animated", STRINGS.filterAnimated],
              ["selected", STRINGS.filterSelected],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              className={clsx("animation-menu__filter", {
                "animation-menu__filter--active": filter === value,
              })}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {sequenceTargets.length > 1 && (
          <div className="animation-menu__sequence">
            {sequenceSteps.length > 0 && (
              <ol className="animation-menu__sequence-steps">
                {sequenceSteps.map(([step, labels]) => (
                  <li key={step}>
                    <strong>{step}</strong> {labels.join(", ")}
                  </li>
                ))}
              </ol>
            )}
            {sequenceSteps.some(([, labels]) => labels.length > 1) && (
              <div className="animation-menu__hint">
                {STRINGS.sequenceSharedHint}
              </div>
            )}
            <div className="animation-menu__sequence-actions" role="group">
              <span>
                {selectedDotItems.length > 1
                  ? STRINGS.sequenceOrderSelected
                  : STRINGS.sequenceOrderAll}
              </span>
              <button
                type="button"
                className="animation-menu__secondary"
                onClick={() => orderSequence("ltr")}
              >
                {STRINGS.sequenceLtr}
              </button>
              <button
                type="button"
                className="animation-menu__secondary"
                onClick={() => orderSequence("rtl")}
              >
                {STRINGS.sequenceRtl}
              </button>
              <button
                type="button"
                className="animation-menu__secondary"
                onClick={() => orderSequence("clear")}
              >
                {STRINGS.sequenceClear}
              </button>
            </div>
          </div>
        )}
      </div>

      {visibleItems.length ? (
        <ul className="animation-menu__list" ref={listRef}>
          {visibleItems.map((item) => (
            <AnimationItem
              key={item.element.id}
              item={item}
              selected={isSelected(item)}
              onFocus={() => focusElement(item.element)}
              onSelectDots={() => selectElements(item.dots)}
              onLabelSide={(side) => setLabelSide(item, side)}
              onLabelFollowsPath={(follows) =>
                setLabelFollowsPath(item, follows)
              }
              onChange={(animation, dotCount) =>
                updateAnimation(item.element, animation, dotCount)
              }
            />
          ))}
        </ul>
      ) : (
        <div className="animation-menu__empty">
          {items.length ? STRINGS.emptyFilter : STRINGS.empty}
        </div>
      )}

      <div className="animation-menu__footer">
        <button
          type="button"
          className="animation-menu__primary"
          disabled={!elements.length}
          onClick={() => setIsPreviewOpen(true)}
        >
          {STRINGS.preview}
        </button>
      </div>

      {isPreviewOpen && (
        <AnimationPreviewDialog onClose={() => setIsPreviewOpen(false)} />
      )}
    </div>
  );
};
