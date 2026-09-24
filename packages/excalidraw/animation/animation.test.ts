import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { serializeAsJSON } from "../data/json";
import { restoreElements } from "../data/restore";
import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";

import {
  ANIMATION_CUSTOM_DATA_KEY,
  getDefaultAnimation,
  getElementAnimation,
  withElementAnimation,
} from "./types";

import type { ElementAnimation } from "./types";

const POINTS = [
  pointFrom<LocalPoint>(0, 0),
  pointFrom<LocalPoint>(200, 0),
  pointFrom<LocalPoint>(200, 100),
];

const createArrow = (
  animation: Partial<ElementAnimation> | null,
  opts: Record<string, unknown> = {},
) => {
  const arrow = API.createElement({
    type: "arrow",
    x: 0,
    y: 0,
    points: POINTS,
    roughness: 0,
    strokeWidth: 2,
    startArrowhead: null,
    endArrowhead: "arrow",
    ...opts,
  });
  return {
    ...arrow,
    customData: animation
      ? { [ANIMATION_CUSTOM_DATA_KEY]: animation, other: 1 }
      : undefined,
  } as NonDeletedExcalidrawElement;
};

const exportSvg = (elements: NonDeletedExcalidrawElement[]) =>
  exportToSvg(
    elements,
    { exportBackground: false, viewBackgroundColor: "#fff" },
    null,
    { skipInliningFonts: true },
  );

const FLOW: ElementAnimation = {
  type: "flow",
  direction: "forward",
  duration: 1000,
  dashLength: 10,
  gapLength: 6,
};

describe("element animation config", () => {
  it("returns null for non-animatable or unconfigured elements", () => {
    expect(getElementAnimation(createArrow(null))).toBeNull();
    expect(
      getElementAnimation({
        ...API.createElement({ type: "rectangle" }),
        customData: { [ANIMATION_CUSTOM_DATA_KEY]: FLOW },
      }),
    ).toBeNull();
    expect(getElementAnimation(createArrow({ type: "bogus" as any }))).toBe(
      null,
    );
  });

  it("fills in and clamps invalid values", () => {
    expect(
      getElementAnimation(
        createArrow({ type: "flow", duration: -5, dashLength: "x" as any }),
      ),
    ).toEqual({
      type: "flow",
      direction: "forward",
      duration: 100,
      dashLength: 8,
      gapLength: 5,
    });
  });

  it("derives the default direction from arrowheads", () => {
    const direction = (start: any, end: any) =>
      getDefaultAnimation(
        createArrow(null, { startArrowhead: start, endArrowhead: end }) as any,
        "flow",
      ).direction;
    expect(direction(null, "arrow")).toBe("forward");
    expect(direction("arrow", null)).toBe("reverse");
    expect(direction("arrow", "arrow")).toBe("alternate");
  });

  it("keeps unrelated customData when setting/removing", () => {
    const arrow = createArrow(FLOW) as any;
    expect(withElementAnimation(arrow, null)).toEqual({ other: 1 });
    expect(withElementAnimation({ ...arrow, customData: undefined }, FLOW))
      .toMatchInlineSnapshot(`
      {
        "animation": {
          "dashLength": 10,
          "direction": "forward",
          "duration": 1000,
          "gapLength": 6,
          "type": "flow",
        },
      }
    `);
  });
});

describe("animation persistence", () => {
  it("survives a .excalidraw save/load round-trip", () => {
    const json = serializeAsJSON([createArrow(FLOW)], {}, {}, "local");
    const [restored] = restoreElements(JSON.parse(json).elements, null);
    expect(getElementAnimation(restored)).toEqual(FLOW);
    expect(restored.customData?.other).toBe(1);
  });
});

describe("animated SVG export", () => {
  it("does not animate elements without config", async () => {
    const svg = await exportSvg([createArrow(null)]);
    expect(svg.querySelector("animate, animateMotion")).toBeNull();
  });

  it("animates only the curve of an arrow, not the arrowhead", async () => {
    const svg = await exportSvg([createArrow(FLOW)]);
    const animated = svg.querySelectorAll("path[stroke-dasharray]");
    expect(animated).toHaveLength(1);
    const curve = animated[0];
    expect(curve.getAttribute("stroke-dasharray")).toBe("10 6");

    // every rough sub-path runs from segment start to segment end, so
    // forward (decreasing offset) moves towards the arrow end
    expect(
      curve
        .getAttribute("d")!
        .match(/M\S+ \S+/g)!
        .map((m) => m.slice(1)),
    ).toEqual(["0 0", "0 0", "200 0", "200 0"]);

    const animate = curve.querySelector("animate")!;
    expect(animate.getAttribute("attributeName")).toBe("stroke-dashoffset");
    expect(animate.getAttribute("values")).toBe("0;-16");
    expect(animate.getAttribute("dur")).toBe("1000ms");
    expect(animate.getAttribute("repeatCount")).toBe("indefinite");

    const arrowheadPaths = [...svg.querySelectorAll("path")].filter(
      (path) => path !== curve,
    );
    expect(arrowheadPaths.length).toBeGreaterThan(0);
    arrowheadPaths.forEach((path) =>
      expect(path.querySelector("animate")).toBeNull(),
    );
  });

  it("reverses and alternates flow", async () => {
    const reverse = await exportSvg([
      createArrow({ ...FLOW, direction: "reverse" }),
    ]);
    expect(reverse.querySelector("animate")!.getAttribute("values")).toBe(
      "0;16",
    );

    const alternate = await exportSvg([
      createArrow({ ...FLOW, direction: "alternate" }),
    ]);
    const animate = alternate.querySelector("animate")!;
    expect(animate.getAttribute("values")).toBe("0;-48;0");
    expect(animate.getAttribute("dur")).toBe("6000ms");
  });

  it("draws through a centerline mask and fades arrowheads in", async () => {
    const svg = await exportSvg([
      createArrow({ ...FLOW, type: "draw" }, { roughness: 1 }),
    ]);
    const mask = svg.querySelector("mask[id^='animation-draw-']")!;
    expect(mask.getAttribute("maskUnits")).toBe("userSpaceOnUse");
    const reveal = mask.querySelector("path")!;
    expect(reveal.getAttribute("d")).toBe("M0 0 L200 0 L200 100");
    expect(reveal.getAttribute("stroke-dashoffset")).toBe("0");
    expect(reveal.querySelector("animate")!.getAttribute("values")).toBe(
      "1;0;0",
    );

    const masked = svg.querySelector(`g[mask="url(#${mask.id})"]`)!;
    expect(masked.querySelectorAll("path").length).toBeGreaterThan(0);

    const fades = [...svg.querySelectorAll("animate")].filter(
      (animate) => animate.getAttribute("attributeName") === "opacity",
    );
    // the "arrow" arrowhead consists of two strokes
    expect(fades).toHaveLength(2);
    fades.forEach((fade) => expect(masked.contains(fade)).toBe(false));
  });

  it("pulses the curve opacity", async () => {
    const svg = await exportSvg([createArrow({ ...FLOW, type: "pulse" })]);
    const animate = svg.querySelector("animate")!;
    expect(animate.getAttribute("attributeName")).toBe("opacity");
    expect(animate.parentElement!.tagName).toBe("path");
  });

  it("doesn't draw a dot of its own for dot animations", async () => {
    const svg = await exportSvg([createArrow({ ...FLOW, type: "dot" })]);
    expect(svg.querySelector("circle, animateMotion")).toBeNull();
  });

  it("animates lines", async () => {
    const line = {
      ...API.createElement({ type: "line", points: POINTS, roughness: 0 }),
      customData: { [ANIMATION_CUSTOM_DATA_KEY]: FLOW },
    };
    const svg = await exportSvg([line]);
    expect(svg.querySelectorAll("animate")).toHaveLength(1);
  });

  it("animates elbow arrows", async () => {
    const svg = await exportSvg([
      createArrow(FLOW, { elbowed: true, roughness: 0 }),
    ]);
    expect(svg.querySelectorAll("animate")).toHaveLength(1);
  });
});
