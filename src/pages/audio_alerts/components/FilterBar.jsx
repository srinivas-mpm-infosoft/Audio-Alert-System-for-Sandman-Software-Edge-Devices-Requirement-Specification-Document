import React from "react";
import { Search, X } from "lucide-react";

export default function FilterBar({ filters, onFilterChange, fields = [], placeholder = "Search…", showSearch = true }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showSearch && (
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
          <input
            type="text"
            value={filters.search ?? ""}
            onChange={(e) => onFilterChange({ ...filters, search: e.target.value })}
            placeholder={placeholder}
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700"
            aria-label="Search"
          />
        </div>
      )}

      {fields.map((field) => (
        <div key={field.key} className="min-w-[120px]">
          <label className="sr-only">{field.label}</label>
          <select
            value={filters[field.key] ?? ""}
            onChange={(e) => onFilterChange({ ...filters, [field.key]: e.target.value || undefined })}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700"
            aria-label={field.label}
          >
            <option value="">{field.label}: All</option>
            {field.options.map((o) => (
              <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
            ))}
          </select>
        </div>
      ))}

      {/* Date range */}
      {filters.from !== undefined && (
        <div className="flex items-center gap-1">
          <label className="sr-only">From date</label>
          <input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => onFilterChange({ ...filters, from: e.target.value || undefined })}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700"
            aria-label="From date"
          />
          <span className="text-slate-400 text-xs">–</span>
          <input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => onFilterChange({ ...filters, to: e.target.value || undefined })}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700"
            aria-label="To date"
          />
        </div>
      )}

      {/* Clear all */}
      {Object.values(filters).some(Boolean) && (
        <button
          type="button"
          onClick={() => {
            const cleared = {};
            Object.keys(filters).forEach((k) => { cleared[k] = k === "from" || k === "to" ? undefined : ""; });
            onFilterChange(cleared);
          }}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded-lg hover:bg-slate-100"
          aria-label="Clear all filters"
        >
          <X size={12} aria-hidden="true" /> Clear
        </button>
      )}
    </div>
  );
}
