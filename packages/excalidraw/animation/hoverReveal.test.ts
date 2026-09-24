import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";

import { applyHoverReveal } from "./hoverReveal";
import { optimizeSvg } from "./optimize";
import { ANIMATION_CUSTOM_DATA_KEY } from "./types";

const labelledArrow = (id: string, animated: boolean) => {
  const arrow = API.createElement({
    type: "arrow",
    id,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
  });
  const text = API.createElement({
    type: "text",
    id: `${id}-label`,
    text: `label of ${id}`,
    containerId: id,
  });
  return [
    {
      ...arrow,
      boundElements: [{ type: "text", id: text.id }],
      ...(animated
        ? {
            customData: {
              [ANIMATION_CUSTOM_DATA_KEY]: {
                type: "flow",
                direction: "forward",
                duration: 1000,
                dashLength: 10,
                gapLength: 6,
              },
            },
          }
        : {}),
    },
    text,
  ] as NonDeletedExcalidrawElement[];
};

const setup = async () => {
  const elements = [
    ...labelledArrow("animated", true),
    ...labelledArrow("static", false),
    API.createElement({ type: "text", id: "title", text: "Title" }),
  ] as NonDeletedExcalidrawElement[];
  const svg = await exportToSvg(
    elements,
    { exportBackground: false, viewBackgroundColor: "#fff" },
    null,
    { skipInliningFonts: true },
  );
  const elementsMap = new Map(elements.map((el) => [el.id, el]));
  const textNode = (content: string) =>
    [...svg.querySelectorAll("text")].find((text) =>
      text.textContent?.includes(content),
    )!.parentElement!;
  return { svg, elements, elementsMap, textNode };
};

describe("hover reveal", () => {
  it("tags only labels of animated lines", async () => {
    const { textNode } = await setup();
    expect([...textNode("label of animated").classList]).toEqual([
      "ea-animated-label",
    ]);
    expect(textNode("label of static").hasAttribute("class")).toBe(false);
    expect(textNode("Title").hasAttribute("class")).toBe(false);
  });

  it("does nothing when off", async () => {
    const { svg, elements, elementsMap } = await setup();
    const before = svg.outerHTML;
    applyHoverReveal(svg, "off", elements, elementsMap as any);
    expect(svg.outerHTML).toBe(before);
  });

  it("hides only animated labels, and closes their line gap", async () => {
    const { svg, elements, elementsMap } = await setup();
    applyHoverReveal(svg, "animated", elements, elementsMap as any);
    expect(svg.classList.contains("ea-hover-reveal")).toBe(true);
    const css = svg.querySelector("style")!.textContent!;
    expect(css).toContain(
      ".ea-hover-reveal:not(:hover) .ea-animated-label{opacity:0}",
    );
    expect(css).toContain('[mask="url(#mask-animated)"]');
    expect(css).not.toContain("mask-static");
    expect(css).not.toContain(" text{");
  });

  it("hides all text", async () => {
    const { svg, elements, elementsMap } = await setup();
    applyHoverReveal(svg, "all", elements, elementsMap as any);
    const css = svg.querySelector("style")!.textContent!;
    expect(css).toContain(".ea-hover-reveal:not(:hover) text{opacity:0}");
    expect(css).toContain('[mask="url(#mask-animated)"]');
    expect(css).toContain('[mask="url(#mask-static)"]');
  });

  it("survives size optimization", async () => {
    const { svg, elements, elementsMap } = await setup();
    applyHoverReveal(svg, "animated", elements, elementsMap as any);
    optimizeSvg(svg);
    expect(svg.querySelector("#mask-animated")).not.toBeNull();
    expect(svg.querySelector(".ea-animated-label")).not.toBeNull();
    expect(svg.querySelector("style")!.textContent).toContain("opacity:0");
  });
});
