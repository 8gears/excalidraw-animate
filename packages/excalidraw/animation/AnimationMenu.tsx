import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  getBoundTextElement,
  getCommonBounds,
  isArrowElement,
  newElementWith,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  useApp,
  useExcalidrawElements,
  useExcalidrawSetAppState,
} from "../components/App";
import { useUIAppState } from "../context/ui-appState";

import { AnimationPreviewDialog } from "./AnimationPreviewDialog";
import { createAnimationDot, getAnimationDot } from "./dot";
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
  /** for `dot` animations: the dot element, null if it was deleted */
  dot: NonDeletedExcalidrawElement | null;
};

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
  onSelectDot,
}: {
  item: Item;
  selected: boolean;
  onFocus: () => void;
  onChange: (animation: ElementAnimation | null) => void;
  onSelectDot: () => void;
}) => {
  const { element, label, animation, dot } = item;
  const isDotMissing = animation?.type === "dot" && !dot;

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
          {animation.type === "dot" &&
            (dot ? (
              <button
                type="button"
                className="animation-menu__secondary animation-menu__wide"
                onClick={onSelectDot}
              >
                {STRINGS.selectDot}
              </button>
            ) : (
              <div className="animation-menu__wide animation-menu__warning">
                <span>{STRINGS.dotMissing}</span>
                <button
                  type="button"
                  className="animation-menu__secondary"
                  onClick={() => onChange({ ...animation, dotId: undefined })}
                >
                  {STRINGS.addDot}
                </button>
              </div>
            ))}
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
      const text = getBoundTextElement(element, elementsMap)
        ?.text.replace(/\s+/g, " ")
        .trim();
      result.push({
        element,
        label: text
          ? text.length > LABEL_MAX_LENGTH
            ? `${text.slice(0, LABEL_MAX_LENGTH)}…`
            : text
          : `${STRINGS[kind]} ${counters[kind]}`,
        animation: getElementAnimation(element),
        dot: getAnimationDot(element, elementsMap),
      });
    }
    return result;
  }, [elements, app]);

  // selecting a line's dot on the canvas counts as selecting the line
  const isSelected = (item: Item) =>
    !!selectedElementIds[item.element.id] ||
    (!!item.dot && !!selectedElementIds[item.dot.id]);
  const isAnimated = (item: Item) =>
    !!item.animation && (item.animation.type !== "dot" || !!item.dot);

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

  const updateAnimation = (
    line: AnimatableElement,
    animation: ElementAnimation | null,
  ) => {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const currentDot = getAnimationDot(line, elementsMap);
    let next = animation;
    let dotToAdd: NonDeletedExcalidrawElement | null = null;
    if (next?.type === "dot") {
      if (currentDot) {
        next = { ...next, dotId: currentDot.id };
      } else {
        dotToAdd = createAnimationDot(line, next.direction, elementsMap);
        next = { ...next, dotId: dotToAdd.id };
      }
    } else if (next) {
      const { dotId: _, ...rest } = next;
      next = rest;
    }
    // the dot only exists for the animation, so it goes along with it
    const dotToRemove = next?.type !== "dot" ? currentDot : null;

    // one update, so a single undo reverts both the line and its dot
    app.api.updateScene({
      elements: app.scene.getElementsIncludingDeleted().flatMap((el) => {
        if (el.id === line.id) {
          const updated = newElementWith(el, {
            customData: withElementAnimation(line, next),
          });
          return dotToAdd ? [updated, dotToAdd] : [updated];
        }
        if (dotToRemove && el.id === dotToRemove.id) {
          return [newElementWith(el, { isDeleted: true })];
        }
        return [el];
      }),
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
      </div>

      {visibleItems.length ? (
        <ul className="animation-menu__list" ref={listRef}>
          {visibleItems.map((item) => (
            <AnimationItem
              key={item.element.id}
              item={item}
              selected={isSelected(item)}
              onFocus={() => focusElement(item.element)}
              onSelectDot={() => item.dot && focusElement(item.dot)}
              onChange={(animation) => updateAnimation(item.element, animation)}
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
