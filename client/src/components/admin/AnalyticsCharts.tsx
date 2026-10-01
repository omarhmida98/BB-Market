import { useId } from "react";

/**
 * Minimal SVG chart primitives for the analytics dashboard.
 *
 * WHY NOT RECHARTS
 * ----------------
 * `recharts` is already a declared dependency, so this is a deliberate choice not
 * to use it rather than a missing one. Recharts and its d3 dependencies account
 * for a large slice of the client bundle, and the only two charts on this page are
 * a bar series and a sparkline. Hand-rolled SVG is a few hundred bytes, renders
 * identically in light and dark mode through Tailwind classes, and adds no
 * runtime to the admin route. Importing it for two charts would be a poor trade.
 *
 * WHY THE CHARTS STAY LEFT-TO-RIGHT IN ARABIC
 * --------------------------------------------
 * `recharts` and most chart libraries mirror the x-axis in RTL, which is right for
 * category axes and wrong for a time series: a rising trend then reads as falling,
 * and the "last day" label ends up on the left. The dates here are absolute and
 * always ascend, so the axis is pinned to chronological order and only the
 * surrounding text follows the page direction. `direction: ltr` is set on the SVG
 * so the browser cannot undo this.
 *
 * Every chart is a `viewBox` with `preserveAspectRatio="none"`-free scaling, so it
 * fills its column at any width and needs no resize observer.
 */

export type ChartPoint = { date: string; value: number };

const AXIS = "hsl(var(--muted-foreground))";

/**
 * Shared scale/geometry for a vertical bar chart.
 *
 * Returned as data rather than drawn so the hover layer and the visible layer are
 * guaranteed to agree on where a bar is; a second calculation drifting from the
 * first is how tooltips end up pointing at the wrong bar.
 *
 * Named `barGeometry`, not `useBarGeometry`: it is a pure computation called after
 * `BarChart` has already returned early for the empty state, and a `use` prefix
 * would mark it as a hook subject to the rules of hooks. Calling it conditionally is
 * harmless while it stays hook-free, but the first `useMemo` added inside it would
 * throw whenever a chart went from zero to non-zero data.
 */
function barGeometry(points: ChartPoint[], height: number) {
  const width = 1000;
  const padTop = 12;
  const padBottom = 4;
  const plot = height - padTop - padBottom;

  // A zero maximum would make every division by max produce Infinity/NaN and render
  // nothing at all, which is exactly the "no sales yet" case the empty state has to
  // survive. Floor the axis at 1 so a flat-zero series draws as flat zero-height bars.
  const rawMax = points.reduce((m, p) => Math.max(m, p.value), 0);
  const max = rawMax > 0 ? rawMax : 1;

  const slot = width / Math.max(points.length, 1);
  // Wide gaps look airy for 7 points and wasteful for 90, so the bar takes a fixed
  // fraction of its slot with a floor, and the slot itself shrinks the gap.
  const barWidth = Math.max(Math.min(slot * 0.62, 46), 1.5);

  return {
    width,
    height,
    barWidth,
    max,
    y: (value: number) => padTop + plot * (1 - value / max),
  };
}

/** Nice round axis labels, so the y-axis reads 0 / 250 / 500 rather than 0 / 233 / 466. */
function niceTicks(max: number, count = 2): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) out.push(v);
  return out;
}

/**
 * Vertical bar chart with a hover layer.
 *
 * Hover is handled with plain SVG `<title>` per bar rather than pointer events: it
 * needs no state, works with keyboard focus for free, and the browser supplies the
 * tooltip styling. A `<title>` child is the accessible name for the rect, so screen
 * readers announce the same value sighted users get on hover.
 */
export function BarChart({
  points,
  height = 180,
  format,
  ariaLabel,
  emptyLabel,
}: {
  points: ChartPoint[];
  height?: number;
  format: (value: number) => string;
  ariaLabel: string;
  emptyLabel: string;
}) {
  const titleId = useId();
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center" role="status">
        {emptyLabel}
      </p>
    );
  }

  const { width, barWidth, max, y } = barGeometry(points, height);

  return (
    <figure className="m-0" style={{ direction: "ltr" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby={titleId}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{ariaLabel}</title>
        {niceTicks(max).map((tick) => (
          <g key={tick}>
            <line
              x1={0}
              x2={width}
              y1={y(tick)}
              y2={y(tick)}
              stroke={AXIS}
              strokeOpacity={tick === 0 ? 0.5 : 0.18}
              strokeWidth={1}
            />
            <text
              x={2}
              y={y(tick) - 3}
              fontSize={15}
              fill={AXIS}
              className="select-none"
            >
              {format(tick)}
            </text>
          </g>
        ))}
        {points.map((point, i) => {
          const slot = width / points.length;
          const top = y(point.value);
          return (
            <rect
              key={point.date}
              x={i * slot + (slot - barWidth) / 2}
              y={top}
              width={barWidth}
              // A zero value must still be a 1px sliver rather than a zero-height
              // rect, which some browsers omit from hit-testing entirely.
              height={Math.max(height - top - 4, 1)}
              rx={Math.min(3, barWidth / 2)}
              className="fill-[#ff6200] transition-opacity hover:opacity-80 focus:opacity-80"
              tabIndex={0}
            >
              <title>{`${point.date} — ${format(point.value)}`}</title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}

/**
 * Sparkline-style line for a compact trend, with an area fill under it.
 *
 * `vectorEffect="non-scaling-stroke"` keeps the stroke one physical pixel: the
 * viewBox is stretched to the column width, so a plain stroke width would be scaled
 * with it and come out visibly thicker on wide screens.
 */
export function TrendChart({
  points,
  height = 64,
  ariaLabel,
  emptyLabel,
}: {
  points: ChartPoint[];
  height?: number;
  ariaLabel: string;
  emptyLabel: string;
}) {
  const titleId = useId();
  if (points.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">{emptyLabel}</p>;
  }

  const width = 1000;
  const pad = 6;
  const max = points.reduce((m, p) => Math.max(m, p.value), 0) || 1;
  const x = (i: number) => pad + (i * (width - pad * 2)) / Math.max(points.length - 1, 1);
  const y = (value: number) => height - pad - (height - pad * 2) * (value / max);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(2)},${height - pad} L${x(0).toFixed(2)},${height - pad} Z`;
  const last = points[points.length - 1];

  return (
    <figure className="m-0" style={{ direction: "ltr" }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{ariaLabel}</title>
        <path d={area} className="fill-[#ff6200]/15" />
        <path d={line} className="stroke-[#ff6200] fill-none" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r={3} className="fill-[#ff6200]" />
      </svg>
    </figure>
  );
}

/**
 * Horizontal magnitude bar, for "top products" and "sales by category".
 *
 * A bar's width is a share of the largest row rather than of the total, because the
 * point of the panel is the ranking: a leader at 60% of a small total and a leader at
 * 60% of a large one should look the same, and the numbers beside the label carry
 * the absolute figure.
 */
export function ShareBar({ value, max, tone = "primary" }: { value: number; max: number; tone?: "primary" | "muted" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden" aria-hidden="true">
      <div
        className={`h-full rounded-full ${tone === "primary" ? "bg-[#ff6200]" : "bg-[#063f2e] dark:bg-emerald-400"}`}
        // The transition is width only, so a hover elsewhere on the row cannot move it.
        style={{ width: `${pct}%`, transition: "width .3s ease" }}
      />
    </div>
  );
}
