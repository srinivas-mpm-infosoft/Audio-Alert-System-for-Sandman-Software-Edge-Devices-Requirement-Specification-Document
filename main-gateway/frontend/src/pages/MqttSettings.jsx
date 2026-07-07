import React, { useState } from "react";
import { Plus, X, Save, Loader2 } from "lucide-react";

const DATA_TYPES = ["String", "Int", "Float", "Boolean", "JSON"];

const inp =
  "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400";
const th =
  "text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 py-2 whitespace-nowrap";
const td = "px-3 py-2 align-middle";

function emptyTopic() {
  return { topic: "", column: "", datatype: "String" };
}

function normalizeMqtt(m) {
  return {
    enabled: m?.enabled ?? false,
    broker_host: m?.broker_host ?? "",
    broker_port: m?.broker_port ?? 1883,
    username: m?.username ?? "",
    password: m?.password ?? "",
    client_id: m?.client_id ?? "",
    use_tls: m?.use_tls ?? false,
    topics: (m?.topics ?? []).map((t) => ({
      topic: t.topic ?? "",
      column: t.column ?? "",
      datatype: t.datatype ?? "String",
    })),
  };
}

export default function MqttSettings({ config, onSave, isReadOnly }) {
  const [mqtt, setMqtt] = useState(() => normalizeMqtt(config?.mqtt));
  const [saving, setSaving] = useState(false);

  // Keep local state in sync when config changes from parent
  React.useEffect(() => {
    setMqtt(normalizeMqtt(config?.mqtt));
  }, [config]);

  const set = (field, value) => setMqtt((m) => ({ ...m, [field]: value }));

  const updTopic = (i, field, value) =>
    setMqtt((m) => {
      const topics = [...m.topics];
      topics[i] = { ...topics[i], [field]: value };
      return { ...m, topics };
    });

  const addTopic = () => setMqtt((m) => ({ ...m, topics: [...m.topics, emptyTopic()] }));
  const removeTopic = (i) =>
    setMqtt((m) => ({ ...m, topics: m.topics.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    setSaving(true);
    const updated = { ...config, mqtt };
    await onSave(updated);
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-2 border-b border-slate-100 pb-4">
        <h2 className="text-lg font-semibold text-slate-800">MQTT Broker Settings</h2>
        <p className="text-sm text-slate-500">Configure MQTT broker connection and topic subscriptions.</p>
      </div>

      {/* Enable toggle */}
      <label className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={mqtt.enabled}
          disabled={isReadOnly}
          onChange={(e) => set("enabled", e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-indigo-600 disabled:opacity-50"
        />
        <span className="text-sm font-medium text-slate-700">Enable MQTT</span>
      </label>

      {/* Connection fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Broker Host</span>
          <input
            className={`${inp} mt-1.5`}
            placeholder="e.g. 192.168.1.100"
            value={mqtt.broker_host}
            disabled={isReadOnly}
            onChange={(e) => set("broker_host", e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Broker Port</span>
          <input
            type="number"
            min="1"
            max="65535"
            className={`${inp} mt-1.5`}
            value={mqtt.broker_port}
            disabled={isReadOnly}
            onChange={(e) => set("broker_port", parseInt(e.target.value, 10) || 1883)}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Client ID</span>
          <input
            className={`${inp} mt-1.5`}
            placeholder="e.g. gateway-client-01"
            value={mqtt.client_id}
            disabled={isReadOnly}
            onChange={(e) => set("client_id", e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Username</span>
          <input
            className={`${inp} mt-1.5`}
            placeholder="optional"
            value={mqtt.username}
            disabled={isReadOnly}
            onChange={(e) => set("username", e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Password</span>
          <input
            type="password"
            className={`${inp} mt-1.5`}
            placeholder="optional"
            value={mqtt.password}
            disabled={isReadOnly}
            onChange={(e) => set("password", e.target.value)}
          />
        </label>

        <label className="flex items-center gap-3 mt-5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
          <input
            type="checkbox"
            checked={mqtt.use_tls}
            disabled={isReadOnly}
            onChange={(e) => set("use_tls", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-indigo-600 disabled:opacity-50"
          />
          <span className="text-sm font-medium text-slate-700">Use TLS / SSL</span>
        </label>
      </div>

      {/* Topics table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Topic Subscriptions</h3>
            <p className="text-xs text-slate-400 mt-0.5">Map MQTT topics to database column names and data types.</p>
          </div>
          {!isReadOnly && (
            <button
              type="button"
              onClick={addTopic}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <Plus size={12} />
              Add Topic
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs" style={{ minWidth: 560 }}>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Topic Path", "Column Name", "Data Type", ""].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {mqtt.topics.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-slate-400 italic text-xs">
                    No topics configured. Click &quot;+ Add Topic&quot; to start.
                  </td>
                </tr>
              )}
              {mqtt.topics.map((t, i) => (
                <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                  <td className={td}>
                    <input
                      value={t.topic}
                      placeholder="factory/line1/temperature"
                      disabled={isReadOnly}
                      onChange={(e) => updTopic(i, "topic", e.target.value)}
                      className={inp}
                    />
                  </td>
                  <td className={td}>
                    <input
                      value={t.column}
                      placeholder="column_name"
                      disabled={isReadOnly}
                      onChange={(e) => updTopic(i, "column", e.target.value)}
                      className={`${inp} w-40`}
                    />
                  </td>
                  <td className={td}>
                    <select
                      value={t.datatype}
                      disabled={isReadOnly}
                      onChange={(e) => updTopic(i, "datatype", e.target.value)}
                      className={`${inp} w-28`}
                    >
                      {DATA_TYPES.map((dt) => <option key={dt}>{dt}</option>)}
                    </select>
                  </td>
                  <td className={td}>
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => removeTopic(i)}
                      className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                      title="Remove topic"
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Save button */}
      <div className="pt-4 border-t border-slate-100">
        <button
          type="button"
          disabled={saving || isReadOnly}
          onClick={handleSave}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm transition-all disabled:opacity-70"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : "Save MQTT Settings"}
        </button>
      </div>
    </div>
  );
}
