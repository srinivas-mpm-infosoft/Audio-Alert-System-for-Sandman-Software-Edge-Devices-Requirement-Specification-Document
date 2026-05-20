import React, { useEffect, useState } from "react";
import {
  Wifi,
  Rss,
  Network as EthernetIcon,
  Save,
  Loader2,
  Globe,
} from "lucide-react";

import { targetUrl } from "../config";
import { useToast } from "../components/ToastContext";

const APN_MAP = {
  jio: "jionet",
  airtel: "airtelgprs.com",
  bsnl: "bsnlnet",
  vi: "www",
};

const emptyIpConfig = () => ({
  ip: "",
  subnet: "",
  gateway: "",
  dns_primary: "",
  dns_secondary: "",
});

const defaultNetwork = {
  wifi: {
    ssid: "",
    password: "",
  },

  sim4g: {
    provider: "",
    apn: "",
  },

  static: {
    iface: "eth0",
    enabled: false,
    internet_router: false,
    ip_configs: [emptyIpConfig()],
  },

  static2: {
    iface: "eth1",
    enabled: false,
    internet_router: false,
    ip_configs: [emptyIpConfig()],
  },
};

export default function Wifi4G({ isReadOnly = false }) {
  const [network, setNetwork] = useState(defaultNetwork);

  const [tab, setTab] = useState("wifi");

  const [status, setStatus] = useState({
    msg: "",
    type: "",
  });

  const [isSaving, setIsSaving] = useState(false);

  const showToast = useToast();

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch(`${targetUrl}/config`, {
          credentials: "include",
        });

        if (!res.ok) return;

        const data = await res.json();

        setNetwork({
          ...defaultNetwork,
          ...data.network,

          wifi: {
            ...defaultNetwork.wifi,
            ...(data.network?.wifi || {}),
          },

          sim4g: {
            ...defaultNetwork.sim4g,
            ...(data.network?.sim4g || {}),
          },

          static: {
            ...defaultNetwork.static,
            ...(data.network?.static || {}),
            ip_configs:
              data.network?.static?.ip_configs ||
              defaultNetwork.static.ip_configs,
          },

          static2: {
            ...defaultNetwork.static2,
            ...(data.network?.static2 || {}),
            ip_configs:
              data.network?.static2?.ip_configs ||
              defaultNetwork.static2.ip_configs,
          },
        });
      } catch (err) {
        console.error("Network load failed", err);
      }
    }

    loadConfig();
  }, []);

  const saveNetwork = async (nextNetwork) => {
    setStatus({
      msg: "",
      type: "",
    });

    setIsSaving(true);

    try {
      const res = await fetch(`${targetUrl}/config`, {
        method: "POST",
        credentials: "include",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          network: nextNetwork,
        }),
      });

      if (res.ok) {
        setNetwork(nextNetwork);

        setStatus({
          msg: "Network configuration saved successfully",
          type: "success",
        });

        showToast(
          "Network configuration saved successfully",
          "success"
        );
      } else {
        setStatus({
          msg: "Failed to save network configuration",
          type: "error",
        });

        showToast(
          "Failed to save network configuration",
          "error"
        );
      }
    } catch (err) {
      setStatus({
        msg: "Network error while saving",
        type: "error",
      });

      showToast(
        "Network error while saving",
        "error"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const updateNetwork = (path, value) => {
    setNetwork((prev) => {
      const updated = { ...prev };

      const keys = path.split(".");

      let target = updated;

      for (let i = 0; i < keys.length - 1; i += 1) {
        target = target[keys[i]] = {
          ...target[keys[i]],
        };
      }

      target[keys[keys.length - 1]] = value;

      return updated;
    });
  };

  const updateApnForProvider = (provider) => {
    let apn = network.sim4g.apn;

    if (provider !== "other" && provider !== "") {
      apn = APN_MAP[provider] || "";
    }

    updateNetwork("sim4g.provider", provider);
    updateNetwork("sim4g.apn", apn);
  };

  const tabs = [
    {
      id: "wifi",
      label: "Wi-Fi",
      icon: Wifi,
    },

    {
      id: "sim",
      label: "4G SIM",
      icon: Rss,
    },

    {
      id: "static",
      label: "Ethernet 1",
      icon: EthernetIcon,
    },

    {
      id: "static2",
      label: "Ethernet 2",
      icon: EthernetIcon,
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="flex-shrink-0 p-6 bg-white border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">
          Network Configuration
        </h1>

        <p className="text-slate-500 text-sm">
          Manage connectivity settings for Wi-Fi,
          Cellular, and Ethernet.
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden p-6 gap-8">

        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 h-full">
          <nav className="space-y-1">
            {tabs.map((t) => {
              const Icon = t.icon;

              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);

                    setStatus({
                      msg: "",
                      type: "",
                    });
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all ${
                    tab === t.id
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon size={18} />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6">

              {/* WIFI */}
              {tab === "wifi" && (
                <div className="space-y-6 animate-in fade-in duration-300">

                  <h3 className="text-lg font-semibold text-slate-800 border-b pb-2">
                    Wi-Fi Settings
                  </h3>

                  <div className="space-y-4">

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        Network SSID
                      </label>

                      <input
                        value={network.wifi.ssid}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updateNetwork(
                            "wifi.ssid",
                            e.target.value
                          )
                        }
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="Enter SSID"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        Password
                      </label>

                      <input
                        type="password"
                        value={network.wifi.password}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updateNetwork(
                            "wifi.password",
                            e.target.value
                          )
                        }
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="••••••••"
                      />
                    </div>

                  </div>
                </div>
              )}

              {/* SIM */}
              {tab === "sim" && (
                <div className="space-y-6 animate-in fade-in duration-300">

                  <h3 className="text-lg font-semibold text-slate-800 border-b pb-2">
                    4G SIM Configuration
                  </h3>

                  <div className="space-y-4">

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        Service Provider
                      </label>

                      <select
                        value={network.sim4g.provider}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updateApnForProvider(
                            e.target.value
                          )
                        }
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                      >
                        <option value="">
                          Select provider
                        </option>

                        {Object.keys(APN_MAP).map((p) => (
                          <option
                            key={p}
                            value={p}
                          >
                            {p.toUpperCase()}
                          </option>
                        ))}

                        <option value="other">
                          OTHER
                        </option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        APN
                      </label>

                      <div className="relative">
                        <input
                          value={network.sim4g.apn}
                          onChange={(e) =>
                            updateNetwork(
                              "sim4g.apn",
                              e.target.value
                            )
                          }
                          disabled={
                            isReadOnly ||
                            (
                              network.sim4g.provider !== "other" &&
                              network.sim4g.provider !== ""
                            )
                          }
                          className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        />

                        <Globe
                          size={16}
                          className="absolute right-3 top-3 text-slate-400"
                        />
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* ETHERNET */}
              {(tab === "static" || tab === "static2") && (() => {



                return (
                  <div className="space-y-6 animate-in fade-in duration-300">

                    <div className="border-b pb-4 space-y-4">

                      <h3 className="text-lg font-semibold text-slate-800">
                        {tab === "static"
                          ? "Ethernet 1 (eth0)"
                          : "Ethernet 2 (eth1)"}
                      </h3>

                      {/* Enable Static */}
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={network[tab].enabled}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            updateNetwork(
                              `${tab}.enabled`,
                              e.target.checked
                            )
                          }
                          className="sr-only peer"
                        />

                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-indigo-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>

                        <span className="ml-3 text-xs font-bold text-slate-500 uppercase">
                          Enable Static IP
                        </span>
                      </label>

                      {/* Router Mode */}
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={
                            network[tab].internet_router
                          }
                          disabled={isReadOnly}
                          onChange={(e) =>
                            updateNetwork(
                              `${tab}.internet_router`,
                              e.target.checked
                            )
                          }
                          className="h-4 w-4"
                        />

                        <span className="text-xs font-bold text-slate-500 uppercase">
                          Connecting to Internet Router?
                        </span>
                      </label>

                    </div>

                    {/* IP Configs */}
                    <div
                      className={`space-y-6 ${
                        !network[tab].enabled
                          ? "opacity-50 pointer-events-none"
                          : ""
                      }`}
                    >

                      {network[tab].ip_configs.map(
                        (cfg, idx) => (
                          <div
                            key={idx}
                            className="border border-slate-200 rounded-xl p-4 space-y-4"
                          >

                            <div className="flex items-center justify-between">

                              <h4 className="font-semibold text-slate-700">
                                IP Configuration #{idx + 1}
                              </h4>

                              {network[tab].ip_configs
                                .length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [
                                      ...network[tab]
                                        .ip_configs,
                                    ];

                                    updated.splice(idx, 1);

                                    updateNetwork(
                                      `${tab}.ip_configs`,
                                      updated
                                    );
                                  }}
                                  className="text-red-500 text-sm"
                                >
                                  Remove
                                </button>
                              )}

                            </div>

                            <div className="grid grid-cols-2 gap-4">

                              {[
                                {
                                  key: "ip",
                                  label: "IP Address",
                                },

                                {
                                  key: "subnet",
                                  label: "Subnet Mask",
                                },

                                {
                                  key: "gateway",
                                  label: "Gateway",
                                },

                                {
                                  key: "dns_primary",
                                  label: "Primary DNS",
                                },

                                {
                                  key: "dns_secondary",
                                  label: "Secondary DNS",
                                  span: true,
                                },
                              ].map((f) => (
                                <div
                                  key={f.key}
                                  className={
                                    f.span
                                      ? "col-span-2"
                                      : "col-span-1"
                                  }
                                >

                                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">
                                    {f.label}
                                  </label>

                                  <input
                                    value={cfg[f.key]}
                                    disabled={isReadOnly}
                                    onChange={(e) => {
                                      const updated = [
                                        ...network[tab]
                                          .ip_configs,
                                      ];

                                      updated[idx][f.key] =
                                        e.target.value;

                                      updateNetwork(
                                        `${tab}.ip_configs`,
                                        updated
                                      );
                                    }}
                                    className="w-full px-4 py-2 mt-1 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                  />

                                </div>
                              ))}

                            </div>

                          </div>
                        )
                      )}

                      {/* Add IP */}
                      <button
                        type="button"
                        onClick={() => {
                          updateNetwork(
                            `${tab}.ip_configs`,
                            [
                              ...network[tab].ip_configs,
                              emptyIpConfig(),
                            ]
                          );
                        }}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium"
                      >
                        + Add IP Address
                      </button>

                    </div>

                  </div>
                );
              })()}

              {/* SAVE */}
              <div className="mt-10 pt-6 border-t border-slate-100">

                <button
                  className="flex items-center justify-center gap-2 px-8 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition-all w-full md:w-auto disabled:opacity-70"
                  onClick={() => saveNetwork(network)}
                  disabled={isSaving || isReadOnly}
                >
                  {isSaving ? (
                    <Loader2
                      className="animate-spin"
                      size={18}
                    />
                  ) : (
                    <Save size={18} />
                  )}

                  {isSaving
                    ? "Saving..."
                    : "Save Configuration"}
                </button>

              </div>

            </div>
          </div>
        </main>

      </div>
    </div>
  );
}