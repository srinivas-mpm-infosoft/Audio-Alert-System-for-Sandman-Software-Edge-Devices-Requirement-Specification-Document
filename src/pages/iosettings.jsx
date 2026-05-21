import React, { useState, useEffect } from "react";
import { Loader2, AlertCircle, Save } from "lucide-react";

import AnalogIO from "./AnalogIO";
import { useToast } from "../components/ToastContext";
import DigitalIO from "./DigitalIO";
import ModbusRTU from "./ModbusRTU";
import ModbusTCP from "./ModbusTCP";
import MqttSettings from "./MqttSettings";
import {targetUrl} from "../config";


/**
 * IOSettings – config wrapper for all I/O sub-pages.
 *
 * The internal sidebar has been removed. Navigation is driven by the
 * main Sidebar (subTab prop tells us which section to show).
 *
 * subTab values: "general" | "analog" | "digital" | "modbus-rtu" | "modbus-tcp"
 */
export default function IOSettings({ role = "admin", isReadOnly, subTab = "general" }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    fetch(`${targetUrl}/config`,{
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Load failed", err);
        setLoading(false);
      });
  }, []);

  const saveConfig = async (updatedConfig) => {
    setIsSaving(true);
    try {
      const res = await fetch(`${targetUrl}/config`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig),
      });
      if (res.ok) {
        setConfig(updatedConfig);
        const messages = {
          general: "Module switches updated successfully!",
          analog: "Analog calibration saved!",
          digital: "Digital channels updated!",
          "modbus-rtu": "Modbus RTU settings saved!",
          "modbus-tcp": "Modbus TCP settings saved!",
          mqtt: "MQTT settings saved!",
        };
        showToast(messages[subTab] ?? "Settings updated!", "success");
      } else {
        showToast("Failed to save settings", "error");
      }
    } catch {
      showToast("Network error occurred", "error");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin mb-4 text-indigo-600" />
        <p className="font-medium">Loading System Configuration…</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
        <AlertCircle className="h-5 w-5" />
        <p className="font-medium">
          Error: Could not connect to gateway controller.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">I/O Configuration</h1>
        <p className="text-slate-500 text-sm">
          Enable and configure hardware communication protocols.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="animate-in fade-in duration-300">

          {/* ── General – module master switches ── */}
          {subTab === "general" && (
            <div>
              <div className="mb-6 border-b border-slate-100 pb-4">
                <h2 className="text-lg font-semibold text-slate-800">
                  Module Master Switches
                </h2>
                <p className="text-sm text-slate-500">
                  Enable or disable core I/O subsystems.
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.target);
                  const nc = JSON.parse(JSON.stringify(config));
                  nc.ioSettings.settings.modbus = fd.get("modbus") === "on";
                  nc.ioSettings.settings.modbusTCP = fd.get("modbusTCP") === "on";
                  nc.ioSettings.settings.analog = fd.get("analog") === "on";
                  nc.ioSettings.settings.digitalInput =
                    fd.get("digitalInput") === "on";
                  saveConfig(nc);
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      name: "modbus",
                      label: "Modbus RTU Protocol",
                      checked: config.ioSettings?.settings?.modbus,
                    },
                    {
                      name: "modbusTCP",
                      label: "Modbus TCP/IP Protocol",
                      checked: config.ioSettings?.settings?.modbusTCP,
                    },
                    // {
                    //   name: "analog",
                    //   label: "Analog Input/Output",
                    //   checked: config.ioSettings?.settings?.analog,
                    // },
                    // {
                    //   name: "digitalInput",
                    //   label: "Digital Input/Output",
                    //   checked: config.ioSettings?.settings?.digitalInput,
                    // },
                  ].map((item) => (
                    <label
                      key={item.name}
                      className="flex items-center p-4 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        name={item.name}
                        defaultChecked={item.checked}
                        disabled={isReadOnly}
                        className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span className="ml-3 font-medium text-slate-700 group-hover:text-slate-900">
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="pt-6 mt-6 border-t border-slate-100">
                  <button
                    type="submit"
                    disabled={isSaving || isReadOnly}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm transition-all disabled:opacity-70"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {isSaving ? "Saving…" : "Save Module Settings"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {subTab === "analog" && (
            <AnalogIO config={config} onSave={saveConfig} isReadOnly={isReadOnly} />
          )}
          {subTab === "digital" && (
            <DigitalIO
              config={config}
              onSave={saveConfig}
              setConfig={setConfig}
              isReadOnly={isReadOnly}
            />
          )}
          {subTab === "modbus-rtu" && (
            <ModbusRTU
              config={config}
              onSave={saveConfig}
              setConfig={setConfig}
              role={role}
              isReadOnly={isReadOnly}
            />
          )}
          {subTab === "modbus-tcp" && (
            <ModbusTCP
              config={config}
              onSave={saveConfig}
              setConfig={setConfig}
            />
          )}
          {subTab === "mqtt" && (
            <MqttSettings
              config={config}
              onSave={saveConfig}
              isReadOnly={isReadOnly}
            />
          )}
        </div>
      </div>
    </div>
  );
}
