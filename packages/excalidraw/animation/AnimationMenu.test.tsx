import React from "react";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { createUndoAction } from "../actions/actionHistory";
import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  withExcalidrawDimensions,
} from "../tests/test-utils";

import {
  ANIMATION_SIDEBAR_NAME,
  AnimationSidebar,
  AnimationSidebarTrigger,
} from "./AnimationSidebar";
import { getElementAnimation } from "./types";

const { h } = window;

describe("AnimationMenu", () => {
  beforeEach(async () => {
    await render(
      <Excalidraw
        initialData={{
          appState: {
            openSidebar: { name: ANIMATION_SIDEBAR_NAME },
          },
        }}
      >
        <AnimationSidebar />
      </Excalidraw>,
    );
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow1",
      startArrowhead: null,
      endArrowhead: "arrow",
    });
    const text = API.createElement({
      type: "text",
      id: "label1",
      text: "Pull image",
      containerId: arrow.id,
    });
    API.setElements([
      { ...arrow, boundElements: [{ type: "text", id: text.id }] },
      text,
      API.createElement({ type: "line", id: "line1" }),
      API.createElement({ type: "rectangle" }),
    ]);
  });

  const getItem = (label: string) =>
    [...document.querySelectorAll(".animation-menu__item")].find(
      (item) =>
        item.querySelector(".animation-menu__item-text")?.textContent === label,
    ) as HTMLElement;

  it("lists all arrows and lines, labelled by bound text", async () => {
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".animation-menu__item-text")].map(
          (node) => node.textContent,
        ),
      ).toEqual(["Pull image", "Line 1"]),
    );
    expect(screen.getByText("2 lines · 0 animated")).toBeInTheDocument();
  });

  it("stores the chosen animation on the element, undoably", async () => {
    await waitFor(() => expect(getItem("Pull image")).toBeTruthy());

    fireEvent.change(getItem("Pull image").querySelector("select")!, {
      target: { value: "flow" },
    });
    await waitFor(() =>
      expect(
        getElementAnimation(h.elements.find((el) => el.id === "arrow1")!),
      ).toMatchObject({ type: "flow", direction: "forward" }),
    );

    const [, direction] = getItem("Pull image").querySelectorAll("select");
    fireEvent.change(direction, { target: { value: "reverse" } });

    const duration = getItem("Pull image").querySelector("input[type=number]")!;
    fireEvent.change(duration, { target: { value: "2500" } });
    // not committed until blur
    expect(
      getElementAnimation(h.elements.find((el) => el.id === "arrow1")!)
        ?.duration,
    ).toBe(1000);
    fireEvent.blur(duration);

    await waitFor(() =>
      expect(
        getElementAnimation(h.elements.find((el) => el.id === "arrow1")!),
      ).toMatchObject({ type: "flow", direction: "reverse", duration: 2500 }),
    );
    expect(screen.getByText("2 lines · 1 animated")).toBeInTheDocument();

    API.executeAction(createUndoAction(h.history));
    await waitFor(() =>
      expect(
        getElementAnimation(h.elements.find((el) => el.id === "arrow1")!)
          ?.duration,
      ).toBe(1000),
    );

    fireEvent.change(getItem("Pull image").querySelector("select")!, {
      target: { value: "none" },
    });
    await waitFor(() =>
      expect(
        getElementAnimation(h.elements.find((el) => el.id === "arrow1")!),
      ).toBeNull(),
    );
  });

  it("scrolls the list to the element selected on the canvas", async () => {
    await waitFor(() => expect(getItem("Line 1")).toBeTruthy());
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      API.setSelectedElements([
        h.elements.find(
          (el) => el.id === "line1",
        ) as NonDeletedExcalidrawElement,
      ]);
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      expect(scrollIntoView.mock.contexts[0]).toBe(getItem("Line 1"));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

      // editing the selected item must not scroll again
      fireEvent.change(getItem("Line 1").querySelector("select")!, {
        target: { value: "flow" },
      });
      await waitFor(() =>
        expect(
          getElementAnimation(h.elements.find((el) => el.id === "line1")!),
        ).not.toBeNull(),
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("filters to animated elements", async () => {
    await waitFor(() => expect(getItem("Line 1")).toBeTruthy());
    fireEvent.change(getItem("Line 1").querySelector("select")!, {
      target: { value: "pulse" },
    });
    fireEvent.click(screen.getByText("Animated"));
    await waitFor(() =>
      expect(document.querySelectorAll(".animation-menu__item")).toHaveLength(
        1,
      ),
    );
    expect(getItem("Line 1")).toBeTruthy();
  });
});

describe("AnimationSidebarTrigger", () => {
  it("toggles the animation sidebar", async () => {
    await render(
      <Excalidraw>
        <AnimationSidebarTrigger />
        <AnimationSidebar />
      </Excalidraw>,
    );
    expect(document.querySelector(".animation-menu")).toBeNull();
    fireEvent.click(screen.getByTitle("Animations"));
    await waitFor(() =>
      expect(h.state.openSidebar?.name).toBe(ANIMATION_SIDEBAR_NAME),
    );
    expect(document.querySelector(".animation-menu")).toBeTruthy();
  });

  it("stays open when clicking the canvas, e.g. to select an arrow", async () => {
    await render(
      <Excalidraw>
        <AnimationSidebarTrigger />
        <AnimationSidebar />
      </Excalidraw>,
    );
    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      fireEvent.click(screen.getByTitle("Animations"));
      await waitFor(() =>
        expect(h.state.openSidebar?.name).toBe(ANIMATION_SIDEBAR_NAME),
      );
      fireEvent.pointerDown(document.querySelector("canvas.interactive")!);
      expect(h.state.openSidebar?.name).toBe(ANIMATION_SIDEBAR_NAME);
      expect(document.querySelector(".animation-menu")).toBeTruthy();
    });
  });
});
