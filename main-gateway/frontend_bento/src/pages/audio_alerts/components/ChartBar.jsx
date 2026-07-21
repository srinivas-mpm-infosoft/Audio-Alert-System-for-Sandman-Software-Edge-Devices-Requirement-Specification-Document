import React from "react";

export default function ChartBar({ data, valueKey = "count", labelKey = "label", colorKey, height = 180, barColor = "#6366f1", horizontal = false, maxBars = 10 }) {
  const trimmed = data.slice(0, maxBars);
  if (!trimmed.length) return <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No data</div>;

  const max = Math.max(...trimmed.map((d) => d[valueKey] || 0), 1);

  if (horizontal) {
    return (
      <div className="space-y-2" style={{ minHeight: height }}>
        {trimmed.map((d, i) => {
          const pct = ((d[valueKey] || 0) / max) * 100;
          const color = colorKey && d[colorKey] ? d[colorKey] : barColor;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-32 truncate flex-shrink-0" title={d[labelKey]}>{d[labelKey]}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-5 relative overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: color }}
                  role="progressbar"
                  aria-valuenow={d[valueKey]}
                  aria-valuemin={0}
                  aria-valuemax={max}
                  aria-label={`${d[labelKey]}: ${d[valueKey]}`}
                />
              </div>
              <span className="text-xs font-bold text-slate-700 w-8 text-right">{d[valueKey]}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${trimmed.length * 36} ${height}`} className="w-full" role="img" aria-label="Bar chart">
      {trimmed.map((d, i) => {
        const barH = ((d[valueKey] || 0) / max) * (height - 30);
        const x = i * 36 + 6;
        const y = height - 20 - barH;
        const color = colorKey && d[colorKey] ? d[colorKey] : barColor;
        return (
          <g key={i}>
            <rect x={x} y={y} width={24} height={barH} rx={3} fill={color} />
            <text x={x + 12} y={height - 4} textAnchor="middle" fontSize={9} fill="#94a3b8">{d[labelKey]}</text>
            <text x={x + 12} y={y - 3} textAnchor="middle" fontSize={9} fill="#475569">{d[valueKey]}</text>
          </g>
        );
      })}
    </svg>
  );
}
