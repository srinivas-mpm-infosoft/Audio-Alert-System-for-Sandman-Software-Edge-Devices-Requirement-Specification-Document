import React from "react";

function smoothPath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const cpx = (points[i - 1].x + points[i].x) / 2;
    d += ` C ${cpx} ${points[i - 1].y} ${cpx} ${points[i].y} ${points[i].x} ${points[i].y}`;
  }
  return d;
}

export default function ChartLine({ data, valueKeys = ["value"], colors = ["#6366f1"], labelKey = "date", height = 180, showRollingAvg = false }) {
  if (!data || !data.length) return <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No data</div>;

  const W = 600;
  const H = height;
  const PAD = { top: 20, right: 20, bottom: 28, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const allVals = data.flatMap((d) => valueKeys.map((k) => d[k] || 0));
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  const xScale = (i) => PAD.left + (i / (data.length - 1)) * innerW;
  const yScale = (v) => PAD.top + innerH - ((v - minVal) / range) * innerH;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => minVal + (i / ticks) * range);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Line chart">
      {/* Y grid */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yScale(v)} y2={yScale(v)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={PAD.left - 4} y={yScale(v) + 4} textAnchor="end" fontSize={9} fill="#94a3b8">{Math.round(v)}</text>
        </g>
      ))}

      {/* X labels */}
      {data.map((d, i) => {
        if (i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) return null;
        const label = d[labelKey] ? String(d[labelKey]).slice(5) : i;
        return (
          <text key={i} x={xScale(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="#94a3b8">{label}</text>
        );
      })}

      {/* Series */}
      {valueKeys.map((k, ki) => {
        const points = data.map((d, i) => ({ x: xScale(i), y: yScale(d[k] || 0) }));
        const path = smoothPath(points);
        const color = colors[ki] ?? "#6366f1";
        return (
          <g key={k}>
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
            ))}
          </g>
        );
      })}

      {/* 7-day rolling avg overlay */}
      {showRollingAvg && (() => {
        const primary = valueKeys[0];
        const avgData = data.map((d, i) => {
          const window = data.slice(Math.max(0, i - 3), i + 4);
          const avg = window.reduce((s, x) => s + (x[primary] || 0), 0) / window.length;
          return { x: xScale(i), y: yScale(avg) };
        });
        const avgPath = smoothPath(avgData);
        return <path d={avgPath} fill="none" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" />;
      })()}
    </svg>
  );
}
