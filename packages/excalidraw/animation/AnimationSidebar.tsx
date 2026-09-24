import { useCallback, useState } from "react";

import { useEditorInterface } from "../components/App";
import { RIGHT_SIDEBAR_WIDTH } from "../components/App.viewport";

import { createIcon } from "../components/icons";
import { Sidebar } from "../components/Sidebar/Sidebar";

import { AnimationMenu } from "./AnimationMenu";
import { STRINGS } from "./strings";

export const ANIMATION_SIDEBAR_NAME = "animation";

const animationIcon = createIcon(
  <>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M3 17c3 0 4 -10 8 -10s4 10 8 10" strokeDasharray="3 3" />
    <path d="M17 14l2 3l3 -2" />
  </>,
  {
    width: 24,
    height: 24,
    fill: "none",
    strokeWidth: 2,
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
);

/** toggles the animation sidebar; render anywhere inside `<Excalidraw>` */
export const AnimationSidebarTrigger = () => (
  <Sidebar.Trigger
    name={ANIMATION_SIDEBAR_NAME}
    icon={animationIcon}
    title={STRINGS.title}
    className="animation-sidebar-trigger"
  >
    {STRINGS.trigger}
  </Sidebar.Trigger>
);

const WIDTH_STORAGE_KEY = "excalidraw-animate-sidebar-width";
const DEFAULT_WIDTH = RIGHT_SIDEBAR_WIDTH;
const MIN_WIDTH = 240;
/** fraction of the editor width the sidebar may take at most */
const MAX_WIDTH_RATIO = 0.7;

const loadWidth = () => {
  try {
    const width = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(width) && width >= MIN_WIDTH ? width : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
};

const saveWidth = (width: number) => {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  } catch {
    // storage unavailable (private mode), width just isn't remembered
  }
};

const ResizeHandle = ({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number, commit: boolean) => void;
}) => {
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = event.currentTarget.closest(".excalidraw");
      if (!container) {
        return;
      }
      event.preventDefault();
      const { right, width: editorWidth } = container.getBoundingClientRect();
      const clamp = (clientX: number) =>
        Math.round(
          Math.min(
            editorWidth * MAX_WIDTH_RATIO,
            Math.max(MIN_WIDTH, right - clientX),
          ),
        );
      const onMove = (moveEvent: PointerEvent) =>
        onResize(clamp(moveEvent.clientX), false);
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        onResize(clamp(upEvent.clientX), true);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onResize],
  );

  return (
    <div
      className="animation-sidebar__resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      title={STRINGS.resize}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(DEFAULT_WIDTH, true)}
    />
  );
};

/** render as a child of `<Excalidraw>` */
export const AnimationSidebar = () => {
  const [width, setWidth] = useState(loadWidth);
  const { canFitSidebar } = useEditorInterface();

  const onResize = useCallback((nextWidth: number, commit: boolean) => {
    setWidth(nextWidth);
    if (commit) {
      saveWidth(nextWidth);
    }
  }, []);

  return (
    <Sidebar
      name={ANIMATION_SIDEBAR_NAME}
      className="animation-sidebar"
      // undocked sidebars close on any outside click, e.g. when selecting an
      // arrow on the canvas; without `onDock` the pin button is hidden
      docked
    >
      {canFitSidebar && (
        <>
          {/*
            upstream sizes sidebars (and the docked canvas layout) through an
            inline --right-sidebar-width on the editor container, so it's
            overridden only while this sidebar is mounted
          */}
          <style>{`.excalidraw:has(.animation-sidebar){--right-sidebar-width:${width}px !important;}`}</style>
          <ResizeHandle width={width} onResize={onResize} />
        </>
      )}
      <Sidebar.Header>
        <div className="animation-sidebar__title">{STRINGS.title}</div>
      </Sidebar.Header>
      <AnimationMenu />
    </Sidebar>
  );
};
