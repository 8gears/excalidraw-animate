import React from "react";

import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { actionDeleteSelected } from "../actions/actionDeleteSelected";
import { createUndoAction } from "../actions/actionHistory";
import { Excalidraw } from "../index";
import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";
import { fireEvent, render, screen, waitFor } from "../tests/test-utils";

import { ANIMATION_SIDEBAR_NAME, AnimationSidebar } from "./AnimationSidebar";
import {
  ANIMATION_DOT_CUSTOM_DATA_KEY,
  getAnimationDot,
  remapAnimationReferences,
} from "./dot";
import { ANIMATION_CUSTOM_DATA_KEY, getElementAnimation } from "./types";

const { h } = window;

const POINTS = [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)];

const DOT_ANIMATION = {
  type: "dot",
  direction: "forward",
  duration: 1000,
  dashLength: 10,
  gapLength: 6,
} as const;

const createPair = ({
  dotBackRef = "arrow1",
  dotDeleted = false,
}: { dotBackRef?: string; dotDeleted?: boolean } = {}) => {
  const arrow = {
    ...API.createElement({
      type: "arrow",
      id: "arrow1",
      x: 100,
      y: 50,
      points: POINTS,
      roughness: 0,
    }),
    customData: {
      [ANIMATION_CUSTOM_DATA_KEY]: { ...DOT_ANIMATION, dotId: "dot1" },
    },
  } as NonDeletedExcalidrawElement;
  const dot = {
    ...API.createElement({
      type: "ellipse",
      id: "dot1",
      // drawn somewhere else than the arrow start on purpose
      x: 500,
      y: 500,
      width: 20,
      height: 20,
      isDeleted: dotDeleted,
    }),
    customData: { [ANIMATION_DOT_CUSTOM_DATA_KEY]: { arrowId: dotBackRef } },
  } as NonDeletedExcalidrawElement;
  return [arrow, dot];
};

const exportSvg = (elements: NonDeletedExcalidrawElement[]) =>
  exportToSvg(
    elements.filter((element) => !element.isDeleted),
    { exportBackground: false, viewBackgroundColor: "#fff" },
    null,
    { skipInliningFonts: true },
  );

describe("moving dot export", () => {
  it("moves the dot element along the line, from wherever it was drawn", async () => {
    const svg = await exportSvg(createPair());
    const motions = svg.querySelectorAll("animateMotion");
    expect(motions).toHaveLength(1);
    // relative to the dot center (510, 510): arrow runs (100,50) -> (300,50)
    expect(motions[0].getAttribute("path")).toBe("M-410 -460 L-210 -460");
    expect(motions[0].getAttribute("keyPoints")).toBe("0;1");
    expect(motions[0].getAttribute("dur")).toBe("1000ms");
    // on an inner group of the dot's node (which carries the transform)
    const node = motions[0].parentElement!.parentElement!;
    expect(node.getAttribute("transform")).toMatch(/^translate\(/);
    // no label, so no mask
    expect(node.hasAttribute("mask")).toBe(false);
  });

  it("passes under the line's label like the line does", async () => {
    const [arrow, dot] = createPair();
    const label = API.createElement({
      type: "text",
      id: "label1",
      text: "label",
      containerId: arrow.id,
    });
    const svg = await exportSvg([
      { ...arrow, boundElements: [{ type: "text", id: label.id }] },
      dot,
      label,
    ] as NonDeletedExcalidrawElement[]);

    const node =
      svg.querySelector("animateMotion")!.parentElement!.parentElement!;
    expect(node.getAttribute("mask")).toBe("url(#animation-dot-mask-dot1)");
    // same hole as the line's own label mask, just in the dot's local frame
    const lineHole = svg.querySelector("#mask-arrow1 rect[fill='#000']")!;
    const dotHole = svg.querySelector(
      "#animation-dot-mask-dot1 rect[fill='#000']",
    )!;
    for (const attr of ["x", "y", "width", "height"]) {
      expect(Number(dotHole.getAttribute(attr))).toBeCloseTo(
        Number(lineHole.getAttribute(attr)),
        1,
      );
    }
    const [, tx, ty] = node
      .getAttribute("transform")!
      .match(/translate\(([-\d.]+) ([-\d.]+)\)/)!;
    expect(dotHole.getAttribute("transform")).toBe(
      `rotate(0 10 10) translate(${-Number(tx)} ${-Number(ty)})`,
    );
  });

  it("is disabled when the dot is deleted", async () => {
    const svg = await exportSvg(createPair({ dotDeleted: true }));
    expect(svg.querySelector("animateMotion")).toBeNull();
  });

  it("is disabled when the dot links to another line", async () => {
    const svg = await exportSvg(createPair({ dotBackRef: "other" }));
    expect(svg.querySelector("animateMotion")).toBeNull();
  });
});

describe("remapAnimationReferences", () => {
  const duplicate = (
    originals: ExcalidrawElement[],
    idMap: Record<string, string>,
  ) => {
    const duplicates = originals.map((element) => ({
      ...element,
      id: idMap[element.id],
    }));
    return remapAnimationReferences(duplicates, originals, {
      duplicateElements: new Map(duplicates.map((el) => [el.id, el])),
      originalElements: new Map(originals.map((el) => [el.id, el])),
      origIdToDuplicateId: new Map(Object.entries(idMap)),
      duplicateIdToOrigId: new Map(
        Object.entries(idMap).map(([orig, dup]) => [dup, orig]),
      ),
    });
  };

  it("links copied pairs to each other", () => {
    const result = duplicate(createPair(), { arrow1: "arrow2", dot1: "dot2" })!;
    const elementsMap = new Map(result.map((el) => [el.id, el]));
    expect(getAnimationDot(elementsMap.get("arrow2")!, elementsMap)?.id).toBe(
      "dot2",
    );
  });

  it("leaves a line copied without its dot disabled", () => {
    const [arrow, dot] = createPair();
    expect(duplicate([arrow], { arrow1: "arrow2" })).toBeUndefined();
    const elementsMap = new Map([
      [arrow.id, arrow],
      [dot.id, dot],
      ["arrow2", { ...arrow, id: "arrow2" }],
    ]);
    expect(getAnimationDot(elementsMap.get("arrow2")!, elementsMap)).toBe(null);
  });
});

describe("moving dot sidebar", () => {
  beforeEach(async () => {
    await render(
      <Excalidraw
        initialData={{
          appState: { openSidebar: { name: ANIMATION_SIDEBAR_NAME } },
        }}
      >
        <AnimationSidebar />
      </Excalidraw>,
    );
    API.setElements([
      API.createElement({
        type: "arrow",
        id: "arrow1",
        x: 100,
        y: 50,
        points: POINTS,
        strokeColor: "#1971c2",
        startArrowhead: null,
        endArrowhead: "arrow",
      }),
    ]);
  });

  const typeSelect = () =>
    document.querySelector(".animation-menu__item select") as HTMLElement;
  const arrow = () => h.elements.find((el) => el.id === "arrow1")!;
  const dots = () =>
    h.elements.filter(
      (el) => el.customData?.[ANIMATION_DOT_CUSTOM_DATA_KEY] && !el.isDeleted,
    );

  it("adds a styleable dot element at the line start", async () => {
    await waitFor(() => expect(typeSelect()).toBeTruthy());
    fireEvent.change(typeSelect(), { target: { value: "dot" } });

    await waitFor(() => expect(dots()).toHaveLength(1));
    const [dot] = dots();
    expect(dot).toMatchObject({
      type: "ellipse",
      strokeColor: "#1971c2",
      backgroundColor: "#1971c2",
    });
    expect(dot.x + dot.width / 2).toBe(100);
    expect(dot.y + dot.height / 2).toBe(50);
    expect(getElementAnimation(arrow())?.dotId).toBe(dot.id);

    fireEvent.click(screen.getByText("Select dot to style it"));
    await waitFor(() =>
      expect(h.state.selectedElementIds).toEqual({ [dot.id]: true }),
    );
  });

  it("removes the dot when switching to another animation, undoably", async () => {
    await waitFor(() => expect(typeSelect()).toBeTruthy());
    fireEvent.change(typeSelect(), { target: { value: "dot" } });
    await waitFor(() => expect(dots()).toHaveLength(1));

    fireEvent.change(typeSelect(), { target: { value: "flow" } });
    await waitFor(() => expect(dots()).toHaveLength(0));
    expect(getElementAnimation(arrow())).toMatchObject({ type: "flow" });
    expect(getElementAnimation(arrow())?.dotId).toBeUndefined();

    API.executeAction(createUndoAction(h.history));
    await waitFor(() => expect(dots()).toHaveLength(1));
    expect(getElementAnimation(arrow())?.type).toBe("dot");
  });

  it("disables the animation when the dot is deleted and can re-add it", async () => {
    await waitFor(() => expect(typeSelect()).toBeTruthy());
    fireEvent.change(typeSelect(), { target: { value: "dot" } });
    await waitFor(() => expect(dots()).toHaveLength(1));

    API.setSelectedElements([dots()[0] as NonDeletedExcalidrawElement]);
    API.executeAction(actionDeleteSelected);
    await waitFor(() => expect(dots()).toHaveLength(0));
    await waitFor(() =>
      expect(
        screen.getByText("No dot on the canvas, animation disabled."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("1 line · 0 animated")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Add dot"));
    await waitFor(() => expect(dots()).toHaveLength(1));
    expect(getElementAnimation(arrow())?.dotId).toBe(dots()[0].id);
    expect(screen.getByText("1 line · 1 animated")).toBeInTheDocument();
  });
});
