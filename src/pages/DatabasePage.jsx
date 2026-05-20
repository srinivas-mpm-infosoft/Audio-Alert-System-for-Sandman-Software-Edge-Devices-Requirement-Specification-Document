import React, { useEffect, useState } from "react";
import { Database, Cloud, Save, CheckCircle, AlertCircle, Loader2 } from "lucide-react"; // Optional icons for flair
import { useToast } from "../components/ToastContext"; // Importing toast context for notifications
import { targetUrl } from "../config";

const defaultDatabase = {
  local: {
    enabled: true,
    cred: { host: "", port: 3306, user: "", password: "", database: "" },
  },
  cloud: {
    enabled: false,
    cred: { host: "", port: 3306, user: "", password: "", database: "" },
  },
};

export default function DatabasePage({ isReadOnly = false }) {
  const [config, setConfig] = useState(null);
  const [database, setDatabase] = useState(defaultDatabase);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: "", type: "" });
  const showToast = useToast(); // Accessing the toast function from context

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch(`${targetUrl}/config`,{
          credentials: 'include',
        });
        const data = await res.json();
        const db = data.Database || defaultDatabase;
        setConfig(data);
        // Normalize keys (ensuring 'database' vs 'db' consistency)
        const normalize = (section) => ({
          enabled: section?.enabled ?? false,
          cred: {
            host: section?.cred?.host ?? "",
            port: section?.cred?.port ?? 3306,
            user: section?.cred?.user ?? "",
            password: section?.cred?.password ?? "",
            database: section?.cred?.database ?? section?.cred?.db ?? "",
          }
        });

        setDatabase({
          local: normalize(db.local),
          cloud: normalize(db.cloud),
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  const updateCred = (section, key, value) => {
    setDatabase((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        cred: {
          ...prev[section].cred,
          [key]: key === "port" ? Number(value) : value,
        },
      },
    }));
  };

  const toggleEnabled = (section) => {
    setDatabase((prev) => ({
      ...prev,
      [section]: { ...prev[section], enabled: !prev[section].enabled },
    }));
  };

  const saveDatabaseConfig = async () => {
    if (!config) return;
    setSaving(true);
    setStatus({ message: "", type: "" });

    const next = { ...config, Database: database };

    try {
      const res = await fetch(`${targetUrl}/config`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        setConfig(next);
        setStatus({ message: "Configuration saved successfully!", type: "success" });
        showToast("Database Configuration saved successfully!", "success");
      } else {
        setStatus({ message: "Failed to save configuration.", type: "error" });
        showToast("Failed to save configuration.", "error");
      }
    } catch (err) {
      setStatus({ message: "Network error. Please try again.", type: "error" });
      showToast("Network error. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        <span>Loading database configuration...</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Database Configuration</h1>
          <p className="text-slate-500 text-sm">Manage your local and cloud database connection strings.</p>
        </div>
        <button
          onClick={saveDatabaseConfig}
          disabled={saving || isReadOnly}
          className="inline-flex items-center justify-center px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg transition-colors shadow-sm gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving Changes..." : "Save Configuration"}
        </button>
      </div>



      {/* Configuration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {['local', 'cloud'].map((name) => {
          const isEnabled = database[name].enabled;
          return (
            <div key={name} className={`bg-white rounded-xl border transition-all duration-200 shadow-sm ${isEnabled ? 'border-indigo-200 ring-1 ring-indigo-50' : 'border-slate-200 opacity-75 grayscale-[0.5]'}`}>
              {/* Card Header */}
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-t-xl">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${isEnabled ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-500'}`}>
                    {name === 'local' ? <Database className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
                  </div>
                  <h3 className="font-bold text-slate-800 uppercase tracking-tight">{name} Database</h3>
                </div>

                {/* Toggle Switch */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={isEnabled}
                    disabled={isReadOnly}
                    onChange={() => toggleEnabled(name)}
                  />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {/* Form Content */}
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-6">
                  {Object.entries(database[name].cred).map(([key, val]) => (
                    <div key={`${name}-${key}`} className={key === 'host' ? 'sm:col-span-4' : key === 'port' ? 'sm:col-span-2' : 'sm:col-span-3'}>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 ml-1">
                        {key}
                      </label>
                      <input
                        disabled={!isEnabled || isReadOnly}
                        type={key === "password" ? "password" : "text"}
                        value={val}
                        onChange={(e) => updateCred(name, key, e.target.value)}
                        className="w-100 block w-full px-4 py-2 text-slate-900 border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 transition-all sm:text-sm"
                        placeholder={`Enter ${key}...`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}