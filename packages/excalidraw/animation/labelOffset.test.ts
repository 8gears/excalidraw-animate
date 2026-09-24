import {
  applyLabelOffset,
  getClearLabelOffset,
  LABEL_OFFSET_CUSTOM_DATA_KEY,
} from "@excalidraw/element/labelOffset";
import { LinearElementEditor } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawTextElementWithContainer,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";

const text = (offset: number | null, labelPosition = 0.5) =>
  ({
    ...API.createElement({ type: "text", text: "label" }),
    width: 40,
    height: 20,
    labelPosition,
    customData:
      offset === null ? undefined : { [LABEL_OFFSET_CUSTOM_DATA_KEY]: offset },
  } as unknown as ExcalidrawTextElementWithContainer);

// straight horizontal path from (x0, 0) to (x1, 0)
const horizontal = (x0: number, x1: number) => (t: number) =>
  pointFrom<GlobalPoint>(x0 + (x1 - x0) * t, 0);

describe("applyLabelOffset", () => {
  it("keeps the position without an offset", () => {
    expect(
      applyLabelOffset(text(null), { x: 1, y: 2 }, horizontal(0, 100)),
    ).toEqual({ x: 1, y: 2 });
  });

  it("puts positive offsets below and negative above, either way drawn", () => {
    for (const path of [horizontal(0, 100), horizontal(100, 0)]) {
      expect(applyLabelOffset(text(30), { x: 0, y: 0 }, path).y).toBeCloseTo(
        30,
      );
      expect(applyLabelOffset(text(-30), { x: 0, y: 0 }, path).y).toBeCloseTo(
        -30,
      );
    }
  });

  it("moves sideways (positive = right) on vertical lines", () => {
    const down = (t: number) => pointFrom<GlobalPoint>(0, 100 * t);
    const up = (t: number) => pointFrom<GlobalPoint>(0, 100 - 100 * t);
    for (const path of [down, up]) {
      const { x, y } = applyLabelOffset(text(30), { x: 0, y: 0 }, path);
      expect(x).toBeCloseTo(30);
      expect(y).toBeCloseTo(0);
    }
  });

  it("clears the line by the label's size in the normal direction", () => {
    // horizontal line: half the height (10) + half stroke (1) + 6
    expect(getClearLabelOffset(text(0), "below", 2, horizontal(0, 100))).toBe(
      17,
    );
    expect(getClearLabelOffset(text(0), "above", 2, horizontal(0, 100))).toBe(
      -17,
    );
  });
});

describe("label offset in the editor and export", () => {
  const scene = (offset: number | null) => {
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow1",
      x: 0,
      y: 100,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
    });
    const label = {
      ...API.createElement({
        type: "text",
        id: "label1",
        text: "Push",
        containerId: arrow.id,
      }),
      labelPosition: 0.5,
      customData:
        offset === null
          ? undefined
          : { [LABEL_OFFSET_CUSTOM_DATA_KEY]: offset },
    };
    return [
      { ...arrow, boundElements: [{ type: "text", id: label.id }] },
      label,
    ] as unknown as NonDeletedExcalidrawElement[];
  };

  it("positions the label off the line", () => {
    const [arrow, label] = scene(-30);
    const [, plain] = scene(null);
    const map = new Map([
      [arrow.id, arrow],
      [label.id, label],
    ]) as any;
    const moved = LinearElementEditor.getBoundTextElementPosition(
      arrow as any,
      label as any,
      map,
    );
    const onLine = LinearElementEditor.getBoundTextElementPosition(
      arrow as any,
      plain as any,
      new Map([
        [arrow.id, arrow],
        [plain.id, plain],
      ]) as any,
    );
    expect(moved.x).toBeCloseTo(onLine.x);
    expect(moved.y).toBeCloseTo(onLine.y - 30);
  });

  it("moves the line's label hole along, so the line isn't cut", async () => {
    // relative to the line: the export's origin moves with the scene bounds
    const holeY = async (offset: number | null) => {
      const svg = await exportToSvg(
        scene(offset),
        { exportBackground: false, viewBackgroundColor: "#fff" },
        null,
        { skipInliningFonts: true },
      );
      const hole = svg.querySelector("#mask-arrow1 rect[fill='#000']")!;
      const lineY = Number(
        svg
          .querySelector("g[mask='url(#mask-arrow1)'] > g")!
          .getAttribute("transform")!
          .match(/translate\([-\d.]+ ([-\d.]+)\)/)![1],
      );
      return Number(hole.getAttribute("y")) - lineY;
    };
    expect((await holeY(null)) - (await holeY(-30))).toBeCloseTo(30);
  });
});
