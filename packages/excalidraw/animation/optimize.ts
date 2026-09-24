/**
 * Size optimizations for exported SVGs that are safe for the SMIL animations
 * (unlike e.g. SVGO's default preset, which drops some of them).
 */

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const PATH_TOKEN = /[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/** geometry attributes whose numbers can be rounded without visible change */
const GEOMETRY_ATTRIBUTES = [
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "stroke-width",
  "points",
];

const round = (value: string, precision: number) => {
  const rounded = Number(Number(value).toFixed(precision));
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const roundNumbers = (value: string, precision: number) =>
  value.replace(NUMBER, (num) => round(num, precision));

/** rounds coordinates and drops redundant separators */
export const compactPathData = (d: string, precision: number) => {
  let out = "";
  let previousWasNumber = false;
  for (const token of d.match(PATH_TOKEN) ?? []) {
    if (/^[a-z]$/i.test(token)) {
      out += token;
      previousWasNumber = false;
      continue;
    }
    const num = round(token, precision);
    // a minus sign separates numbers on its own
    if (previousWasNumber && !num.startsWith("-")) {
      out += " ";
    }
    out += num;
    previousWasNumber = true;
  }
  return out;
};

const compactTransform = (transform: string, precision: number) =>
  roundNumbers(transform, precision)
    // rotate(0 cx cy) is an identity transform
    .replace(/rotate\(\s*0(?:[\s,]+[-\d.e]+){0,2}\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

export const optimizeSvg = (
  svg: SVGSVGElement,
  { precision = 1 }: { precision?: number } = {},
) => {
  for (const node of svg.querySelectorAll("*")) {
    const d = node.getAttribute("d");
    if (d) {
      node.setAttribute("d", compactPathData(d, precision));
    }
    const motionPath = node.getAttribute("path");
    if (motionPath && node.tagName === "animateMotion") {
      node.setAttribute("path", compactPathData(motionPath, precision));
    }
    const transform = node.getAttribute("transform");
    if (transform) {
      const compacted = compactTransform(transform, precision);
      if (compacted) {
        node.setAttribute("transform", compacted);
      } else {
        node.removeAttribute("transform");
      }
    }
    for (const name of GEOMETRY_ATTRIBUTES) {
      const value = node.getAttribute(name);
      // skip percentages/units, only plain numbers are rounded
      if (value && !/[%a-df-z]/i.test(value)) {
        node.setAttribute(name, roundNumbers(value, precision));
      }
    }
  }

  // every linear element gets a <mask>, but only labelled ones fill it
  const markup = svg.outerHTML;
  for (const mask of svg.querySelectorAll("mask")) {
    if (mask.children.length) {
      continue;
    }
    if (mask.id && markup.includes(`url(#${mask.id})`)) {
      continue;
    }
    mask.remove();
  }

  return svg;
};
