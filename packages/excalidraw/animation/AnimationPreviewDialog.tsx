import { useEffect, useState } from "react";

import {
  DEFAULT_FILENAME,
  IMAGE_MIME_TYPES,
  MIME_TYPES,
  SVG_DOCUMENT_PREAMBLE,
} from "@excalidraw/common";

import { copyTextToSystemClipboard } from "../clipboard";
import { useApp, useExcalidrawElements } from "../components/App";
import { Dialog } from "../components/Dialog";
import { fileSave } from "../data/filesystem";
import { exportToSvg } from "../scene/export";

import { HOVER_REVEAL_MODES, applyHoverReveal } from "./hoverReveal";
import { optimizeSvg } from "./optimize";
import { HOVER_REVEAL_LABELS, STRINGS } from "./strings";

import type { HoverRevealMode } from "./hoverReveal";

const formatSize = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;

const HOVER_REVEAL_STORAGE_KEY = "excalidraw-animate-hover-reveal";

const loadHoverReveal = (): HoverRevealMode => {
  try {
    const value = localStorage.getItem(HOVER_REVEAL_STORAGE_KEY);
    return HOVER_REVEAL_MODES.find((mode) => mode === value) ?? "off";
  } catch {
    return "off";
  }
};

const saveHoverReveal = (mode: HoverRevealMode) => {
  try {
    localStorage.setItem(HOVER_REVEAL_STORAGE_KEY, mode);
  } catch {
    // storage unavailable, the choice just isn't remembered
  }
};

export const AnimationPreviewDialog = ({
  onClose,
}: {
  onClose: () => void;
}) => {
  const app = useApp();
  const elements = useExcalidrawElements();
  const [embedScene, setEmbedScene] = useState(app.state.exportEmbedScene);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [optimize, setOptimize] = useState(true);
  const [hoverReveal, setHoverReveal] = useState(loadHoverReveal);

  useEffect(() => {
    if (!elements.length) {
      return;
    }
    let cancelled = false;
    exportToSvg(
      elements,
      {
        exportBackground: app.state.exportBackground,
        viewBackgroundColor: app.state.viewBackgroundColor,
        exportWithDarkMode: app.state.exportWithDarkMode,
        exportEmbedScene: embedScene,
      },
      app.files,
    ).then(
      (node) => {
        if (cancelled) {
          return;
        }
        applyHoverReveal(
          node,
          hoverReveal,
          elements,
          app.scene.getNonDeletedElementsMap(),
        );
        setSvg((optimize ? optimizeSvg(node) : node).outerHTML);
      },
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [app, elements, embedScene, optimize, hoverReveal]);

  const download = () => {
    if (!svg) {
      return;
    }
    fileSave(
      new Blob([SVG_DOCUMENT_PREAMBLE + svg], { type: MIME_TYPES.svg }),
      {
        description: STRINGS.previewTitle,
        name: app.getName() || DEFAULT_FILENAME,
        extension: embedScene ? "excalidraw.svg" : "svg",
        mimeTypes: [IMAGE_MIME_TYPES.svg],
      },
    ).catch((err: Error) => {
      // user cancelled the save dialog
      if (err.name !== "AbortError") {
        setError(err.message);
      }
    });
  };

  const copy = async () => {
    if (!svg) {
      return;
    }
    try {
      await copyTextToSystemClipboard(svg);
      setCopied(true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <Dialog
      onCloseRequest={onClose}
      title={STRINGS.previewTitle}
      size="wide"
      className="animation-preview-dialog"
    >
      <div className="animation-preview">
        <div className="animation-preview__canvas">
          {!elements.length ? (
            STRINGS.previewEmpty
          ) : svg ? (
            // our own export output, not user-supplied markup
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            STRINGS.previewLoading
          )}
        </div>
        {error && <div className="animation-preview__error">{error}</div>}
        <div className="animation-preview__options">
          <label className="animation-preview__checkbox">
            {STRINGS.hoverReveal}
            <select
              value={hoverReveal}
              onChange={(event) => {
                const mode = event.target.value as HoverRevealMode;
                setSvg(null);
                setHoverReveal(mode);
                saveHoverReveal(mode);
              }}
            >
              {HOVER_REVEAL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {HOVER_REVEAL_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          {hoverReveal !== "off" && (
            <span className="animation-preview__hint">
              {STRINGS.hoverRevealHint}
            </span>
          )}
        </div>
        <div className="animation-preview__actions">
          <label className="animation-preview__checkbox">
            <input
              type="checkbox"
              checked={optimize}
              onChange={(event) => {
                setSvg(null);
                setOptimize(event.target.checked);
              }}
            />
            {STRINGS.optimize}
          </label>
          <span className="animation-preview__size">
            {svg && formatSize(new Blob([svg]).size)}
          </span>
          <label className="animation-preview__checkbox">
            <input
              type="checkbox"
              checked={embedScene}
              onChange={(event) => {
                setSvg(null);
                setEmbedScene(event.target.checked);
              }}
            />
            {STRINGS.embedScene}
          </label>
          <button
            type="button"
            className="animation-menu__secondary"
            disabled={!svg}
            onClick={copy}
          >
            {copied ? STRINGS.copied : STRINGS.copy}
          </button>
          <button
            type="button"
            className="animation-menu__primary"
            disabled={!svg}
            onClick={download}
          >
            {STRINGS.download}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
