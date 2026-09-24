import React from "react";

import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { createUndoAction } from "../actions/actionHistory";
import { Excalidraw } from "../index";
import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";
import { fireEvent, render, screen, waitFor } from "../tests/test-utils";

import { ANIMATION_SIDEBAR_NAME, AnimationSidebar } from "./AnimationSidebar";
import { ANIMATION_DOT_CUSTOM_DATA_KEY, getSequenceSchedule } from "./dot";
import { ANIMATION_CUSTOM_DATA_KEY, getElementAnimation } from "./types";

import type { ElementAnimation } from "./types";

const { h } = window;

const lineWithDots = (
  id: string,
  x: number,
  dotCount: number,
  animation: Partial<ElementAnimation> = {},
) => {
  const dotIds = Array.from({ length: dotCount }, (_, i) => `${id}-dot${i}`);
  return [
    {
      ...API.createElement({
        type: "arrow",
        id,
        x,
        y: 0,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 0)],
        roughness: 0,
      }),
      customData: {
        [ANIMATION_CUSTOM_DATA_KEY]: {
          type: "dot",
          direction: "forward",
          duration: 1000,
          dashLength: 10,
          gapLength: 6,
          dotIds,
          ...animation,
        },
      },
    },
    ...dotIds.map((dotId) => ({
      ...API.createElement({
        type: "ellipse",
        id: dotId,
        x,
        y: 0,
        width: 10,
        height: 10,
      }),
      customData: { [ANIMATION_DOT_CUSTOM_DATA_KEY]: { arrowId: id } },
    })),
  ] as NonDeletedExcalidrawElement[];
};

const exportSvg = (elements: NonDeletedExcalidrawElement[]) =>
  exportToSvg(
    elements,
    { exportBackground: false, viewBackgroundColor: "#fff" },
    null,
    { skipInliningFonts: true },
  );

const motionsOf = async (elements: NonDeletedExcalidrawElement[]) => {
  const svg = await exportSvg(elements);
  return [...svg.querySelectorAll("animateMotion")].map((motion) => ({
    begin: motion.getAttribute("begin"),
    dur: motion.getAttribute("dur"),
    keyTimes: motion.getAttribute("keyTimes"),
    keyPoints: motion.getAttribute("keyPoints"),
    visibility:
      motion
        .parentElement!.querySelector("animate[attributeName='opacity']")
        ?.getAttribute("keyTimes") ?? null,
  }));
};

describe("multiple moving dots", () => {
  it("spreads the dots evenly over the cycle", async () => {
    const motions = await motionsOf(lineWithDots("a", 0, 4));
    expect(motions.map(({ begin }) => begin)).toEqual([
      null,
      "-750ms",
      "-500ms",
      "-250ms",
    ]);
    motions.forEach((motion) => {
      expect(motion.dur).toBe("1000ms");
      expect(motion.visibility).toBeNull();
    });
  });

  it("spreads over the full back-and-forth for alternate", async () => {
    const motions = await motionsOf(
      lineWithDots("a", 0, 2, { direction: "alternate" }),
    );
    expect(motions.map(({ begin, dur }) => [begin, dur])).toEqual([
      [null, "2000ms"],
      ["-1000ms", "2000ms"],
    ]);
  });
});

describe("sequenced dots", () => {
  it("plays lines one after another on a shared timeline", async () => {
    const motions = await motionsOf([
      ...lineWithDots("second", 200, 1, { sequence: 2, duration: 2000 }),
      ...lineWithDots("first", 0, 1, { sequence: 1, duration: 1000 }),
    ]);
    // export order follows the scene, "second" first
    expect(motions).toEqual([
      {
        begin: null,
        dur: "3000ms",
        keyTimes: "0;0.33;1;1",
        keyPoints: "0;0;1;1",
        visibility: "0;0.33;1",
      },
      {
        begin: null,
        dur: "3000ms",
        keyTimes: "0;0;0.33;1",
        keyPoints: "0;0;1;1",
        visibility: "0;0;0.33",
      },
    ]);
  });

  it("keeps lines with the same number in sync", async () => {
    const motions = await motionsOf([
      ...lineWithDots("a", 0, 1, { sequence: 1 }),
      ...lineWithDots("b", 200, 1, { sequence: 1 }),
    ]);
    expect(motions[0]).toEqual(motions[1]);
    expect(motions[0].keyTimes).toBe("0;0;1;1");
    // whole timeline is theirs, so they're never hidden
    expect(motions[0].visibility).toBeNull();
  });

  it("ignores lines whose dots were all deleted", () => {
    const elements = [
      ...lineWithDots("a", 0, 1, { sequence: 1 }),
      ...lineWithDots("b", 200, 1, { sequence: 2 }).map((el) =>
        el.type === "ellipse" ? { ...el, isDeleted: true } : el,
      ),
    ];
    const schedule = getSequenceSchedule(
      new Map(elements.map((el) => [el.id, el])),
    );
    expect(schedule.total).toBe(1000);
    expect([...schedule.starts.keys()]).toEqual(["a"]);
  });
});

describe("moving dots sidebar", () => {
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
    API.setElements(
      ["right", "left"].map((id, i) =>
        API.createElement({
          type: "arrow",
          id,
          // "right" is first in the scene but further right
          x: i === 0 ? 400 : 0,
          y: 0,
          points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 0)],
          startArrowhead: null,
          endArrowhead: "arrow",
        }),
      ),
    );
  });

  const item = (id: string) =>
    document.querySelector(
      `.animation-menu__item[data-element-id="${id}"]`,
    ) as HTMLElement;
  const dotsOf = (id: string) =>
    h.elements.filter(
      (el) =>
        !el.isDeleted &&
        el.customData?.[ANIMATION_DOT_CUSTOM_DATA_KEY]?.arrowId === id,
    );
  const setDotCount = (id: string, count: number) => {
    const input = [...item(id).querySelectorAll("label")]
      .find((label) => label.textContent?.startsWith("Dots"))!
      .querySelector("input")!;
    fireEvent.change(input, { target: { value: String(count) } });
    fireEvent.blur(input);
  };

  it("adds and removes dots, matching the first dot's style", async () => {
    await waitFor(() => expect(item("left")).toBeTruthy());
    fireEvent.change(item("left").querySelector("select")!, {
      target: { value: "dot" },
    });
    await waitFor(() => expect(dotsOf("left")).toHaveLength(1));

    // user restyles the dot
    API.updateScene({
      elements: h.elements.map((el) =>
        el.id === dotsOf("left")[0].id
          ? { ...el, backgroundColor: "#e03131", width: 20, height: 20 }
          : el,
      ),
    });

    setDotCount("left", 3);
    await waitFor(() => expect(dotsOf("left")).toHaveLength(3));
    dotsOf("left").forEach((dot) =>
      expect(dot).toMatchObject({
        backgroundColor: "#e03131",
        width: 20,
      }),
    );
    // in animation order: the restyled original (widened in place, so its
    // center moved to 5), then new dots at 1/3 and 2/3 of the 100px line
    const animation = getElementAnimation(
      h.elements.find((el) => el.id === "left")!,
    );
    expect(
      animation!.dotIds!.map((id) => {
        const dot = h.elements.find((el) => el.id === id)!;
        return Math.round(dot.x + dot.width / 2);
      }),
    ).toEqual([5, 33, 67]);
    expect(new Set(animation!.dotIds)).toEqual(
      new Set(dotsOf("left").map((dot) => dot.id)),
    );

    setDotCount("left", 1);
    await waitFor(() => expect(dotsOf("left")).toHaveLength(1));

    API.executeAction(createUndoAction(h.history));
    await waitFor(() => expect(dotsOf("left")).toHaveLength(3));
  });

  it("numbers selected lines left to right, and right to left", async () => {
    await waitFor(() => expect(item("left")).toBeTruthy());
    for (const id of ["left", "right"]) {
      fireEvent.change(item(id).querySelector("select")!, {
        target: { value: "dot" },
      });
      await waitFor(() => expect(dotsOf(id)).toHaveLength(1));
    }
    const sequenceOf = (id: string) =>
      getElementAnimation(h.elements.find((el) => el.id === id)!)?.sequence;

    API.setSelectedElements(
      h.elements.filter(
        (el) => el.id === "left" || el.id === "right",
      ) as NonDeletedExcalidrawElement[],
    );
    await waitFor(() => expect(screen.getByText("Left → right")).toBeTruthy());

    fireEvent.click(screen.getByText("Left → right"));
    await waitFor(() => expect(sequenceOf("left")).toBe(1));
    expect(sequenceOf("right")).toBe(2);

    fireEvent.click(screen.getByText("Right → left"));
    await waitFor(() => expect(sequenceOf("right")).toBe(1));
    expect(sequenceOf("left")).toBe(2);

    fireEvent.click(screen.getByText("Clear"));
    await waitFor(() => expect(sequenceOf("left")).toBeUndefined());
    expect(sequenceOf("right")).toBeUndefined();
  });

  it("orders all sequenced lines when nothing is selected", async () => {
    await waitFor(() => expect(item("left")).toBeTruthy());
    for (const id of ["left", "right"]) {
      fireEvent.change(item(id).querySelector("select")!, {
        target: { value: "dot" },
      });
      await waitFor(() => expect(dotsOf(id)).toHaveLength(1));
      // both in step 1, like the user's scene
      const input = [...item(id).querySelectorAll("label")]
        .find((label) => label.textContent?.startsWith("Sequence step"))!
        .querySelector("input")!;
      fireEvent.change(input, { target: { value: "1" } });
      fireEvent.blur(input);
    }
    const sequenceOf = (id: string) =>
      getElementAnimation(h.elements.find((el) => el.id === id)!)?.sequence;
    await waitFor(() => expect(sequenceOf("right")).toBe(1));
    API.setSelectedElements([]);

    await waitFor(() =>
      expect(
        screen.getByText(/Lines in the same step move together/),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Order sequence:")).toBeTruthy();

    fireEvent.click(screen.getByText("Left → right"));
    await waitFor(() => expect(sequenceOf("left")).toBe(1));
    expect(sequenceOf("right")).toBe(2);
    expect(screen.queryByText(/Lines in the same step move together/)).toBe(
      null,
    );
  });
});
