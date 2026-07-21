import { Loader2 } from "lucide-react";

// Shared "bento" design-system primitives — white rounded-2xl cards, pill
// badges, emerald accent. Introduced for the app-wide bento reskin so every
// page composes the same handful of building blocks instead of each file
// hand-rolling its own Tailwind strings.

const TONES = {
  normal: { badge: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  warning: { badge: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  alarm: { badge: "bg-red-50 text-red-700", dot: "bg-red-500" },
  info: { badge: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  offline: { badge: "bg-gray-100 text-gray-500", dot: "bg-gray-400" },
  purple: { badge: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
};

export function Badge({ tone = "offline", children, dot, className = "" }) {
  const t = TONES[tone] || TONES.offline;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${t.badge} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

export function Card({ children, className = "", style, ...props }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`} style={style} {...props}>
      {children}
    </div>
  );
}

export function CardHead({ icon: Icon, title, desc, action }) {
  return (
    <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div>
        <div className="flex items-center gap-2">
          {Icon && (
            <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
            </span>
          )}
          <h3 className="text-[15px] font-bold text-gray-900">{title}</h3>
        </div>
        {desc && <p className="text-xs text-gray-400 mt-1 ml-9">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-emerald-800 text-white hover:bg-emerald-900",
  danger: "bg-red-600 text-white hover:bg-red-700",
  secondary: "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50",
  ghost: "text-gray-500 hover:text-gray-800",
};

export function Button({ variant = "secondary", icon: Icon, children, className = "", loading, disabled, ...props }) {
  const base =
    "inline-flex items-center justify-center gap-2 text-[13px] font-semibold px-4 py-2.5 rounded-full transition-colors active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-50 disabled:pointer-events-none";
  return (
    <button className={`${base} ${BUTTON_VARIANTS[variant]} ${className}`} disabled={loading || disabled} {...props}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : Icon && <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, danger, label, className = "", ...props }) {
  return (
    <button
      type="button"
      aria-label={label || "action"}
      className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none ${
        danger ? "hover:text-red-600 hover:border-red-200" : "hover:text-gray-700"
      } ${className}`}
      {...props}
    >
      <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
    </button>
  );
}

export function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`inline-flex w-9 h-5 rounded-full items-center px-0.5 transition-colors disabled:opacity-50 ${on ? "bg-emerald-700" : "bg-gray-200"}`}
    >
      <span className={`w-4 h-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

export function Field({ label, htmlFor, hint, children }) {
  return (
    <div className="mb-4">
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-gray-500 mb-1.5">
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1.5">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-xl px-3.5 py-2.5 outline-none focus:border-emerald-600 focus:bg-white placeholder:text-gray-400 disabled:opacity-60";

export function PageHeader({ title, desc, action }) {
  return (
    <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h1 className="text-[26px] font-bold text-gray-900 tracking-tight">{title}</h1>
        {desc && <p className="text-sm text-gray-400 mt-1">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function Table({ head, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 bg-gray-50">
            {head.map((h, i) => (
              <th key={i} className="py-2.5 px-3 font-semibold whitespace-nowrap first:rounded-l-lg last:rounded-r-lg">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td = "py-3 px-3 border-b border-gray-50 text-gray-600 whitespace-nowrap";

export function KpiCard({ label, value, sub, dark, icon: Icon }) {
  return (
    <div
      className={`rounded-2xl p-5 ${dark ? "text-white" : "bg-white border border-gray-100 shadow-sm text-gray-900"}`}
      style={dark ? { background: "linear-gradient(135deg,#1c6b47,#0d3a26)" } : undefined}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={`text-[13px] font-semibold ${dark ? "text-white/90" : "text-gray-500"}`}>{label}</span>
        {Icon && (
          <span className={`w-7 h-7 rounded-full flex items-center justify-center ${dark ? "bg-white/15" : "bg-gray-50"}`}>
            <Icon className={`w-3.5 h-3.5 ${dark ? "text-white" : "text-gray-400"}`} strokeWidth={2.25} />
          </span>
        )}
      </div>
      <div className="text-3xl font-bold mb-2">{value}</div>
      {sub && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md ${
            dark ? "bg-white/15 text-white" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

export function Avatar({ label, tone = "bg-emerald-100 text-emerald-700" }) {
  return <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${tone}`}>{label}</span>;
}

// items: [{ key, label }]
export function SubTabs({ items, active, onChange }) {
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={`text-xs font-semibold px-3.5 py-1.5 rounded-full transition-colors ${
            active === it.key ? "bg-emerald-50 text-emerald-800" : "text-gray-400 hover:text-gray-600"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
