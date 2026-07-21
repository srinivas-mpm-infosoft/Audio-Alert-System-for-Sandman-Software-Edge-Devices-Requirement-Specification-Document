import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, X, Shield, Pencil, Check, AlertCircle, Lock, RefreshCw, Save } from "lucide-react";
import { useAuthStore } from "../../store/useAuthStore";
import { useToast } from "../../components/ToastContext";
import { useAppConfigStore } from "../../store/useAppConfigStore";

import { targetUrl } from "../../config";

const BASE = `${targetUrl}/audio-alerts/config`;

const LABEL = "text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block";
const INPUT = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-gray-700";
const SECTION = "bg-white rounded-2xl border border-gray-200 shadow-sm p-5";

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(method, path, body) {
  try {
    const r = await fetch(path, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json();
    return { ok: r.ok && json.ok !== false, ...json };
  } catch (e) {
    return { ok: false, error: "Network error: " + e.message };
  }
}

const apiGet = (path) => apiFetch("GET", path);
const apiPost = (path, body) => apiFetch("POST", path, body);
const apiPut = (path, body) => apiFetch("PUT", path, body);
const apiDelete = (path) => apiFetch("DELETE", path);

// ── Shared sub-components ─────────────────────────────────────────────────────

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
      <Loader2 size={14} className="animate-spin" /> Loading…
    </div>
  );
}

function ErrorRow({ message, onRetry }) {
  return (
    <div className="flex items-center gap-2 text-red-500 text-sm py-4">
      <AlertCircle size={14} />
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-2 text-emerald-600 underline text-xs">Retry</button>
      )}
    </div>
  );
}

function SpinBtn({ loading, onClick, label = "Add" }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 self-end transition-colors disabled:opacity-50">
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {label}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AppSettings() {
  const user = useAuthStore((s) => s.user);
  const showToast = useToast();
  const refreshLanguagesInStore = useAppConfigStore((s) => s.refreshLanguages);

  // Languages
  const [languages, setLanguages] = useState([]);
  const [langLoading, setLangLoading] = useState(true);
  const [langError, setLangError] = useState(null);
  const [newLang, setNewLang] = useState({ code: "", label: "" });
  const [addingLang, setAddingLang] = useState(false);
  const [editLangId, setEditLangId] = useState(null);
  const [editLang, setEditLang] = useState(null);
  const [savingLangId, setSavingLangId] = useState(null);

  // No-translate words
  const [noTransWords, setNoTransWords] = useState([]);
  const [noTransLoading, setNoTransLoading] = useState(true);
  const [noTransError, setNoTransError] = useState(null);
  const [newWord, setNewWord] = useState("");
  const [addingWord, setAddingWord] = useState(false);

  // Zone types
  const [zoneTypes, setZoneTypes] = useState([]);
  const [zoneLoading, setZoneLoading] = useState(true);
  const [zoneError, setZoneError] = useState(null);
  const [newZone, setNewZone] = useState("");
  const [addingZone, setAddingZone] = useState(false);
  const [editZoneId, setEditZoneId] = useState(null);
  const [editZoneLabel, setEditZoneLabel] = useState("");
  const [savingZoneId, setSavingZoneId] = useState(null);

  // Parameters (read-only from channels)
  const [parameters, setParameters] = useState([]);
  const [paramLoading, setParamLoading] = useState(true);
  const [paramError, setParamError] = useState(null);

  // Shift times (used by shift-based scheduling + shift-wise language assignment)
  const [shiftLocal, setShiftLocal] = useState(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [shiftSaving, setShiftSaving] = useState(false);

  useEffect(() => { fetchLanguages(); fetchZoneTypes(); fetchParameters(); fetchNoTransWords(); fetchShiftTimes(); }, []);

  // ── fetch functions ──

  async function fetchLanguages() {
    setLangLoading(true); setLangError(null);
    const res = await apiGet(`${BASE}/languages`);
    if (res.ok) setLanguages(res.data ?? []);
    else setLangError(res.error || "Failed to load languages");
    setLangLoading(false);
  }

  async function fetchZoneTypes() {
    setZoneLoading(true); setZoneError(null);
    const res = await apiGet(`${BASE}/zone-types`);
    if (res.ok) setZoneTypes(res.data ?? []);
    else setZoneError(res.error || "Failed to load zone types");
    setZoneLoading(false);
  }

  async function fetchParameters() {
    setParamLoading(true); setParamError(null);
    const res = await apiGet(`${BASE}/app-settings`);
    if (res.ok) setParameters(res.data?.parameters ?? []);
    else setParamError(res.error || "Failed to load parameters");
    setParamLoading(false);
  }

  async function fetchNoTransWords() {
    setNoTransLoading(true); setNoTransError(null);
    const res = await apiGet(`${BASE}/no-translate`);
    if (res.ok) setNoTransWords(res.data ?? []);
    else setNoTransError(res.error || "Failed to load");
    setNoTransLoading(false);
  }

  async function fetchShiftTimes() {
    setShiftLoading(true);
    const res = await apiGet(`${targetUrl}/audio-alerts/shift-times`);
    setShiftLocal(res.ok ? res.data : { Morning: { start: "06:00", end: "14:00" }, Afternoon: { start: "14:00", end: "22:00" }, Night: { start: "22:00", end: "06:00" } });
    setShiftLoading(false);
  }

  async function saveShiftTimes() {
    if (!shiftLocal) return;
    setShiftSaving(true);
    const res = await apiPut(`${targetUrl}/audio-alerts/shift-times`, shiftLocal);
    if (res.ok) showToast("Shift times saved!", "success");
    else showToast(res.error || "Save failed", "error");
    setShiftSaving(false);
  }

  const patchShift = (shift, field, value) =>
    setShiftLocal((prev) => ({ ...prev, [shift]: { ...prev?.[shift], [field]: value } }));

  // ── access guard ──

  const isAdmin = user?.role === "administrator";
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
        <Shield className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">App Settings is restricted to administrators.</p>
      </div>
    );
  }

  // ── Language handlers ──

  async function handleRefreshLangs() {
    setLangLoading(true); setLangError(null);
    const res = await apiGet(`${BASE}/languages`);
    if (res.ok) {
      setLanguages(res.data ?? []);
      await refreshLanguagesInStore();
    } else {
      setLangError(res.error || "Failed to load languages");
    }
    setLangLoading(false);
  }

  async function handleAddLang() {
    const code = newLang.code.trim().toUpperCase();
    if (!code || !newLang.label.trim()) return;
    if (languages.some((l) => l.code === code)) { showToast("Code already exists", "error"); return; }
    setAddingLang(true);
    const res = await apiPost(`${BASE}/languages`, {
      code, label: newLang.label.trim(),
    });
    if (res.ok) {
      setLanguages((ls) => [...ls, res.data]);
      setNewLang({ code: "", label: "" });
      showToast("Language added", "success");
      await refreshLanguagesInStore();
    } else {
      showToast(res.error || "Failed to add", "error");
    }
    setAddingLang(false);
  }

  async function handleSaveLang() {
    if (!editLang || editLangId == null) return;
    setSavingLangId(editLangId);
    const res = await apiPut(`${BASE}/languages/${editLangId}`, {
      label: editLang.label.trim(),
    });
    if (res.ok) {
      setLanguages((ls) => ls.map((l) => l.id === editLangId ? res.data : l));
      showToast("Language updated", "success");
      await refreshLanguagesInStore();
    } else {
      showToast(res.error || "Failed to update", "error");
    }
    setSavingLangId(null); setEditLangId(null); setEditLang(null);
  }

  async function handleDeleteLang(lang) {
    const res = await apiDelete(`${BASE}/languages/${lang.id}`);
    if (res.ok) {
      setLanguages((ls) => ls.filter((l) => l.id !== lang.id));
      showToast("Language removed", "success");
      await refreshLanguagesInStore();
    } else {
      showToast(res.error || "Failed to delete", "error");
    }
  }

  // ── Zone type handlers ──

  async function handleAddZone() {
    const label = newZone.trim();
    if (!label) return;
    if (zoneTypes.some((z) => z.label === label)) { showToast("Already exists", "error"); return; }
    setAddingZone(true);
    const res = await apiPost(`${BASE}/zone-types`, { label });
    if (res.ok) {
      setZoneTypes((z) => [...z, res.data]);
      setNewZone("");
      showToast("Zone type added", "success");
    } else {
      showToast(res.error || "Failed to add", "error");
    }
    setAddingZone(false);
  }

  async function handleSaveZone() {
    const label = editZoneLabel.trim();
    if (!label || editZoneId == null) return;
    setSavingZoneId(editZoneId);
    const res = await apiPut(`${BASE}/zone-types/${editZoneId}`, { label });
    if (res.ok) {
      setZoneTypes((z) => z.map((x) => x.id === editZoneId ? res.data : x));
      showToast("Zone type updated", "success");
    } else {
      showToast(res.error || "Failed to update", "error");
    }
    setSavingZoneId(null); setEditZoneId(null); setEditZoneLabel("");
  }

  async function handleDeleteZone(zt) {
    const res = await apiDelete(`${BASE}/zone-types/${zt.id}`);
    if (res.ok) {
      setZoneTypes((z) => z.filter((x) => x.id !== zt.id));
      showToast("Zone type removed", "success");
    } else {
      showToast(res.error || "Failed to delete", "error");
    }
  }

  // ── No-translate word handlers ──

  async function handleAddWord() {
    const word = newWord.trim();
    if (!word) return;
    if (noTransWords.some((w) => w.word.toLowerCase() === word.toLowerCase())) {
      showToast("Word already exists", "error"); return;
    }
    setAddingWord(true);
    const res = await apiPost(`${BASE}/no-translate`, { word });
    if (res.ok) {
      setNoTransWords((ws) => [...ws, res.data]);
      setNewWord("");
      showToast("Word added", "success");
    } else {
      showToast(res.error || "Failed to add", "error");
    }
    setAddingWord(false);
  }

  async function handleDeleteWord(w) {
    const res = await apiDelete(`${BASE}/no-translate/${w.id}`);
    if (res.ok) {
      setNoTransWords((ws) => ws.filter((x) => x.id !== w.id));
      showToast("Word removed", "success");
    } else {
      showToast(res.error || "Failed to delete", "error");
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Languages */}
      <div className={SECTION}>
        <div className="border-b border-gray-100 pb-3 mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Languages</h3>
            <p className="text-xs text-gray-400 mt-0.5">Spoken languages available for audio clips and TTS templates</p>
          </div>
          <button onClick={handleRefreshLangs} disabled={langLoading}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="Refresh languages">
            {langLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>

        {langLoading ? <LoadingRow /> :
          langError ? <ErrorRow message={langError} onRetry={handleRefreshLangs} /> : (
            <div className="space-y-1.5 mb-4">
              {languages.length === 0 && (
                <p className="text-gray-400 text-sm">No languages configured yet.</p>
              )}
              {languages.map((l) =>
                editLangId === l.id ? (
                  <div key={l.id} className="flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-200">
                    <span className="font-mono text-xs font-bold text-emerald-800 w-10 text-center shrink-0">{l.code}</span>
                    <input className={`${INPUT} flex-1 text-sm`} value={editLang.label} autoFocus
                      onChange={(e) => setEditLang((x) => ({ ...x, label: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveLang()} />
                    <button onClick={handleSaveLang} disabled={savingLangId === l.id}
                      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                      {savingLangId === l.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button onClick={() => { setEditLangId(null); setEditLang(null); }}
                      className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div key={l.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="font-mono text-xs font-bold text-emerald-800 w-10 shrink-0">{l.code}</span>
                    <span className="text-sm text-gray-700 flex-1">{l.label}</span>
                    <button onClick={() => { setEditLangId(l.id); setEditLang({ ...l }); }}
                      className="p-1 text-gray-400 hover:text-emerald-800 hover:bg-emerald-50 rounded transition-colors">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDeleteLang(l)}
                      className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              )}
            </div>
          )}

        <div className="flex gap-2 items-end flex-wrap">
          <div><label className={LABEL}>Code</label>
            <input className={`${INPUT} w-20`} value={newLang.code} maxLength={5} placeholder="EN"
              onChange={(e) => setNewLang((l) => ({ ...l, code: e.target.value.toUpperCase() }))} /></div>
          <div><label className={LABEL}>Label</label>
            <input className={`${INPUT} w-36`} value={newLang.label} placeholder="English"
              onChange={(e) => setNewLang((l) => ({ ...l, label: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleAddLang()} /></div>
          <SpinBtn loading={addingLang} onClick={handleAddLang} />
        </div>
      </div>

      {/* Zone Types */}
      <div className={SECTION}>
        <div className="border-b border-gray-100 pb-3 mb-4">
          <h3 className="font-semibold text-gray-800">Zone Types</h3>
          <p className="text-xs text-gray-400 mt-0.5">Categories for classifying production zones</p>
        </div>

        {zoneLoading ? <LoadingRow /> :
          zoneError ? <ErrorRow message={zoneError} onRetry={fetchZoneTypes} /> : (
            <div className="flex flex-wrap gap-2 mb-4">
              {zoneTypes.length === 0 && (
                <p className="text-gray-400 text-sm">No zone types configured yet.</p>
              )}
              {zoneTypes.map((zt) =>
                editZoneId === zt.id ? (
                  <span key={zt.id} className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-full">
                    <input className="text-sm font-medium bg-transparent focus:outline-none w-28 text-emerald-800" value={editZoneLabel} autoFocus
                      onChange={(e) => setEditZoneLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveZone(); if (e.key === "Escape") { setEditZoneId(null); setEditZoneLabel(""); } }} />
                    <button onClick={handleSaveZone} disabled={savingZoneId === zt.id}
                      className="text-emerald-600 hover:text-emerald-700">
                      {savingZoneId === zt.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    </button>
                    <button onClick={() => { setEditZoneId(null); setEditZoneLabel(""); }}
                      className="text-gray-400 hover:text-gray-600"><X size={11} /></button>
                  </span>
                ) : (
                  <span key={zt.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-sm font-medium group">
                    {zt.label}
                    <button onClick={() => { setEditZoneId(zt.id); setEditZoneLabel(zt.label); }}
                      className="text-gray-300 hover:text-emerald-600 transition-colors opacity-0 group-hover:opacity-100">
                      <Pencil size={10} />
                    </button>
                    <button onClick={() => handleDeleteZone(zt)}
                      className="text-gray-400 hover:text-red-500 transition-colors"><X size={11} /></button>
                  </span>
                )
              )}
            </div>
          )}

        <div className="flex gap-2">
          <input className={`${INPUT} flex-1 max-w-xs`} value={newZone} placeholder="New zone type…"
            onChange={(e) => setNewZone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddZone()} />
          <SpinBtn loading={addingZone} onClick={handleAddZone} />
        </div>
      </div>

      {/* Process Parameters — read-only, sourced from channels table */}
      <div className={SECTION}>
        <div className="border-b border-gray-100 pb-3 mb-4">
          <h3 className="font-semibold text-gray-800">Process Parameters</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Measurable process variables used in alert rule conditions —{" "}
            <span className="text-emerald-600 font-medium">sourced from enabled channels</span>
          </p>
        </div>

        {paramLoading ? <LoadingRow /> :
          paramError ? <ErrorRow message={paramError} onRetry={fetchParameters} /> :
            parameters.length === 0 ? (
              <p className="text-gray-400 text-sm py-2">
                No enabled channels found. Add channels via <span className="font-medium">Devices &amp; Zones → Channels</span>.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Label</th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {parameters.map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 text-gray-700">{p.label}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500">{p.unit || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>

      {/* No Translation Required */}
      <div className={SECTION}>
        <div className="border-b border-gray-100 pb-3 mb-4">
          <h3 className="font-semibold text-gray-800">No Translation Required</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Words that must never be translated — used as-is across all languages in TTS and audio templates.{" "}
            <span className="text-gray-500">Locked words are pre-registered and cannot be removed.</span>
          </p>
        </div>

        {noTransLoading ? <LoadingRow /> :
          noTransError ? <ErrorRow message={noTransError} onRetry={fetchNoTransWords} /> : (
            <>
              {["foundry", "basic", "custom"].map((cat) => {
                const words = noTransWords.filter((w) => w.category === cat);
                if (words.length === 0 && cat !== "custom") return null;
                const catLabel = cat === "foundry" ? "Foundry" : cat === "basic" ? "Basic / Technical" : "Custom";
                const chipColor = cat === "foundry"
                  ? { base: "bg-blue-50 text-blue-700 border border-blue-200", lock: "text-blue-400" }
                  : cat === "basic"
                  ? { base: "bg-gray-100 text-gray-600 border border-gray-200", lock: "text-gray-400" }
                  : { base: "bg-violet-50 text-violet-700 border border-violet-200", lock: "text-violet-400" };

                return (
                  <div key={cat} className="mb-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{catLabel}</p>
                    {words.length === 0 ? (
                      <p className="text-gray-400 text-xs italic">No custom words added yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {words.map((w) => (
                          <span key={w.id}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${chipColor.base}`}>
                            {w.is_preset
                              ? <Lock size={9} className={`shrink-0 ${chipColor.lock}`} />
                              : null}
                            {w.word}
                            {!w.is_preset && (
                              <button onClick={() => handleDeleteWord(w)}
                                className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors">
                                <X size={10} />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex gap-2 mt-2">
                <input
                  className={`${INPUT} flex-1 max-w-xs`}
                  value={newWord}
                  placeholder="Add a word…"
                  onChange={(e) => setNewWord(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddWord()}
                />
                <SpinBtn loading={addingWord} onClick={handleAddWord} />
              </div>
            </>
          )}
      </div>

      {/* Shift Times */}
      <div className={SECTION}>
        <div className="border-b border-gray-100 pb-3 mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Shift Times</h3>
            <p className="text-xs text-gray-400 mt-0.5">Start/end times for each production shift — used by shift-based scheduling and language assignment</p>
          </div>
          <button onClick={saveShiftTimes} disabled={shiftSaving || !shiftLocal}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {shiftSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
          </button>
        </div>

        {shiftLoading ? <LoadingRow /> : !shiftLocal ? (
          <p className="text-gray-400 text-sm">Could not load shift times.</p>
        ) : (
          <div className="space-y-2">
            {["Morning", "Afternoon", "Night"].map((shift) => (
              <div key={shift} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${shift === "Morning" ? "bg-amber-400" : shift === "Afternoon" ? "bg-orange-500" : "bg-emerald-800"}`} />
                  <span className="font-semibold text-sm text-gray-700">{shift}</span>
                </div>
                <div>
                  <label className={LABEL}>Start Time</label>
                  <input type="time" className={INPUT} value={shiftLocal[shift]?.start ?? ""}
                    onChange={(e) => patchShift(shift, "start", e.target.value)} />
                </div>
                <div>
                  <label className={LABEL}>End Time</label>
                  <input type="time" className={INPUT} value={shiftLocal[shift]?.end ?? ""}
                    onChange={(e) => patchShift(shift, "end", e.target.value)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}