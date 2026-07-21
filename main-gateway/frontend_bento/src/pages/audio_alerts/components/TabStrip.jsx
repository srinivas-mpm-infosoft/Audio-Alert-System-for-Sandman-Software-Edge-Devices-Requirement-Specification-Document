// Shared sub-tab bar for the consolidated Audio Alerts hub pages
// (Monitor / Send Alert / Setup) — matches the existing tab-bar style
// already used in LogsAudit.jsx.
export default function TabStrip({ tabs, active, onChange }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex flex-wrap border-b border-gray-100" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active === tab.key}
              onClick={() => onChange(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-400 ${
                active === tab.key ? "border-b-2 border-emerald-700 text-emerald-800" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {Icon && <Icon size={14} aria-hidden="true" />}
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
