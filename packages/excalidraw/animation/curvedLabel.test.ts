import {
  drawCurvedLabel,
  getCurvedLabelGlyphs,
  getCurvedLabelLayout,
  LABEL_FOLLOWS_PATH_CUSTOM_DATA_KEY,
} from "@excalidraw/element/curvedLabel";
import { LABEL_OFFSET_CUSTOM_DATA_KEY } from "@excalidraw/element/labelOffset";
import { LinearElementEditor } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";

const sample = LinearElementEditor.getPointAtPathParameter;

const scene = ({
  follows = true,
  points = [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(300, 0)],
  roundness = null as { type: 2 } | null,
  offset = 0,
  text = "Push",
} = {}) => {
  const arrow = API.createElement({
    type: "arrow",
    id: "arrow1",
    x: 100,
    y: 100,
    points,
    roundness,
  });
  const label = {
    ...API.createElement({
      type: "text",
      id: "label1",
      text,
      containerId: arrow.id,
    }),
    labelPosition: 0.5,
    customData: {
      ...(follows ? { [LABEL_FOLLOWS_PATH_CUSTOM_DATA_KEY]: true } : {}),
      ...(offset ? { [LABEL_OFFSET_CUSTOM_DATA_KEY]: offset } : {}),
    },
  };
  const elements = [
    { ...arrow, boundElements: [{ type: "text", id: label.id }] },
    label,
  ] as unknown as NonDeletedExcalidrawElement[];
  const map = new Map(elements.map((el) => [el.id, el])) as any;
  return {
    elements,
    map,
    label: elements[1] as unknown as ExcalidrawTextElement,
  };
};

describe("curved label layout", () => {
  it("is off unless the label opts in", () => {
    const { label, map } = scene({ follows: false });
    expect(getCurvedLabelLayout(label, map, sample)).toBeNull();
  });

  it("places glyphs along a straight arrow, in reading order", () => {
    const { label, map } = scene();
    const glyphs = getCurvedLabelGlyphs(
      getCurvedLabelLayout(label, map, sample)!,
    );
    expect(glyphs.map((g) => g.char).join("")).toBe("Push");
    glyphs.forEach((glyph) => {
      expect(glyph.y).toBeCloseTo(100);
      expect(glyph.angle).toBeCloseTo(0);
    });
    for (let i = 1; i < glyphs.length; i++) {
      expect(glyphs[i].x).toBeGreaterThan(glyphs[i - 1].x);
    }
    // centered on the middle of the arrow
    const mid = (glyphs[0].x + glyphs[glyphs.length - 1].x) / 2;
    expect(Math.abs(mid - 250)).toBeLessThan(10);
  });

  it("stays readable on arrows drawn right to left", () => {
    const { label, map } = scene({
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(-300, 0)],
    });
    const glyphs = getCurvedLabelGlyphs(
      getCurvedLabelLayout(label, map, sample)!,
    );
    for (let i = 1; i < glyphs.length; i++) {
      expect(glyphs[i].x).toBeGreaterThan(glyphs[i - 1].x);
    }
    glyphs.forEach((glyph) => expect(Math.abs(glyph.angle)).toBeLessThan(0.01));
  });

  it("follows the curve of a curved arrow", () => {
    const { label, map } = scene({
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(150, -120),
        pointFrom<LocalPoint>(300, 0),
      ],
      roundness: { type: 2 },
      text: "a longer label on a bend",
    });
    const glyphs = getCurvedLabelGlyphs(
      getCurvedLabelLayout(label, map, sample)!,
    );
    // the text climbs, tops out and descends with the arc
    expect(glyphs[0].angle).toBeLessThan(-0.1);
    expect(glyphs[glyphs.length - 1].angle).toBeGreaterThan(0.1);
    const top = Math.min(...glyphs.map((g) => g.y));
    expect(top).toBeLessThan(glyphs[0].y);
    expect(top).toBeLessThan(glyphs[glyphs.length - 1].y);
  });

  it("applies the label offset along the normal", () => {
    const { label, map } = scene({ offset: -20 });
    getCurvedLabelGlyphs(getCurvedLabelLayout(label, map, sample)!).forEach(
      (glyph) => expect(glyph.y).toBeCloseTo(80),
    );
  });

  it("draws one glyph per visible character on canvas", () => {
    const { label, map } = scene({ text: "Pull Image" });
    const fillText = vi.fn();
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D;
    expect(
      drawCurvedLabel(label, map, sample, context, false, { x: 0, y: 0 }),
    ).toBe(true);
    expect(fillText.mock.calls.map(([char]) => char).join("")).toBe(
      "PullImage",
    );

    const plain = scene({ follows: false });
    expect(
      drawCurvedLabel(plain.label, plain.map, sample, context, false, {
        x: 0,
        y: 0,
      }),
    ).toBe(false);
  });
});

describe("curved label SVG export", () => {
  const exportSvg = (elements: NonDeletedExcalidrawElement[]) =>
    exportToSvg(
      elements,
      { exportBackground: false, viewBackgroundColor: "#fff" },
      null,
      { skipInliningFonts: true },
    );

  it("renders the label along a textPath and cuts a curved gap", async () => {
    const svg = await exportSvg(scene().elements);
    // jsdom lowercases tag selectors, which misses camel-cased SVG tags
    const textPath = svg.getElementsByTagName("textPath")[0];
    expect(textPath.textContent).toBe("Push");
    const path = svg.querySelector(textPath.getAttribute("href")!)!;
    expect(path.tagName).toBe("path");
    expect(svg.querySelector("#mask-arrow1 rect[fill='#000']")).toBeNull();
    expect(svg.querySelector("#mask-arrow1 path[fill='#000']")).not.toBeNull();
  });

  it("is unchanged without the setting", async () => {
    const svg = await exportSvg(scene({ follows: false }).elements);
    expect(svg.getElementsByTagName("textPath")).toHaveLength(0);
    expect(svg.querySelector("#mask-arrow1 rect[fill='#000']")).not.toBeNull();
  });
});
