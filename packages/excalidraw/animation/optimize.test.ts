import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";

import { compactPathData, optimizeSvg } from "./optimize";
import { ANIMATION_CUSTOM_DATA_KEY } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

const parse = (markup: string) =>
  new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${markup}</svg>`,
    "image/svg+xml",
  ).documentElement as unknown as SVGSVGElement;

describe("compactPathData", () => {
  it("rounds and drops redundant separators", () => {
    expect(
      compactPathData("M 1.57,-1.57 Q 1.57,-1.57 1.77,-1.27 L 10.04 0.00", 1),
    ).toBe("M1.6-1.6Q1.6-1.6 1.8-1.3L10 0");
  });

  it("keeps exponents and avoids negative zero", () => {
    expect(compactPathData("M1e-7 -0.01 L 2.5e2 3", 1)).toBe("M0 0L250 3");
  });
});

describe("optimizeSvg", () => {
  it("rounds transforms and drops identity rotations", () => {
    const svg = optimizeSvg(
      parse(
        `<g transform="translate(801.0892102084583 355.0537119146859) rotate(0 160.46115299587268 0.6459651801151836)"/>` +
          `<g transform="translate(1.26 2) rotate(45.33 10.01 20.5)"/>` +
          `<g transform="rotate(0 1 2)"/>`,
      ),
    );
    const [a, b, c] = svg.querySelectorAll("g");
    expect(a.getAttribute("transform")).toBe("translate(801.1 355.1)");
    expect(b.getAttribute("transform")).toBe(
      "translate(1.3 2) rotate(45.3 10 20.5)",
    );
    expect(c.hasAttribute("transform")).toBe(false);
  });

  it("removes only empty, unreferenced masks", () => {
    const svg = optimizeSvg(
      parse(
        `<mask id="empty"/>` +
          `<mask id="filled"><rect width="1" height="1"/></mask>` +
          `<mask id="referenced"/><g mask="url(#referenced)"/>`,
      ),
    );
    expect([...svg.querySelectorAll("mask")].map((mask) => mask.id)).toEqual([
      "filled",
      "referenced",
    ]);
  });

  it("leaves units, percentages and animation timing alone", () => {
    const svg = optimizeSvg(
      parse(
        `<rect width="100%" height="10.55px" x="1.26"/>` +
          `<path d="M0 0"><animate attributeName="stroke-dashoffset" values="0;-16.25" keyTimes="0;0.333" dur="1000ms"/></path>`,
      ),
    );
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("width")).toBe("100%");
    expect(rect.getAttribute("height")).toBe("10.55px");
    expect(rect.getAttribute("x")).toBe("1.3");
    const animate = svg.querySelector("animate")!;
    expect(animate.getAttribute("values")).toBe("0;-16.25");
    expect(animate.getAttribute("keyTimes")).toBe("0;0.333");
  });

  it("keeps every animation of a real export and shrinks it", async () => {
    const points = [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(123.456, 7.891),
      pointFrom<LocalPoint>(200.5, 100.25),
    ];
    const elements = (["flow", "draw", "pulse", "dot"] as const).map(
      (type, index) =>
        ({
          ...API.createElement({
            type: "arrow",
            x: 10.123,
            y: index * 150.777,
            points,
          }),
          customData: {
            [ANIMATION_CUSTOM_DATA_KEY]: {
              type,
              direction: "forward",
              duration: 1000,
              dashLength: 10,
              gapLength: 6,
            },
          },
        } as NonDeletedExcalidrawElement),
    );
    const svg = await exportToSvg(
      elements,
      { exportBackground: false, viewBackgroundColor: "#fff" },
      null,
      { skipInliningFonts: true },
    );
    const count = (selector: string) => svg.querySelectorAll(selector).length;
    const animations = count("animate, animateMotion");
    const drawMasks = count("mask[id^='animation-draw-']");
    const before = svg.outerHTML.length;

    optimizeSvg(svg);

    expect(count("animate, animateMotion")).toBe(animations);
    expect(count("mask[id^='animation-draw-']")).toBe(drawMasks);
    expect(svg.outerHTML.length).toBeLessThan(before);
  });
});
