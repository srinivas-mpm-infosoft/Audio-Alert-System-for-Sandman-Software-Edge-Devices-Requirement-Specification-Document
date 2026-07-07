import React, { useEffect, useState } from "react";
import DBSettings from "./DBSettings";

const defaultDigital = {
  pollingInterval: 1,
  pollingIntervalUnit: "Sec",
  channels: [
    { name: "DI1", enabled: false, pin: "" },
    { name: "DI2", enabled: false, pin: "" },
  ],
  db: {
    upload_local: true,
    upload_cloud: false,
    db_name: "",
    table_name: "",
  },
};

const defaultDigitalOutput = {
  channels: [
    { name: "DO1", state: 0, pin: "" },
    { name: "DO2", state: 0, pin: "" },
  ],
};

const defaultRelay = {
  channels: [{ name: "R1", enabled: false, pin: "", mode: "NO" }],
};

export default function DigitalIO({ config, onSave, isReadOnly = false }) {
  const [di, setDi] = useState(defaultDigital);
  const [doo, setDoo] = useState(defaultDigitalOutput);
  const [relay, setRelay] = useState(defaultRelay);

  useEffect(() => {
    const io = config?.ioSettings || {};
    setDi({
      pollingInterval: io.digitalInput?.pollingInterval ?? 1,
      pollingIntervalUnit: io.digitalInput?.pollingIntervalUnit ?? "Sec",
      channels:
        Array.isArray(io.digitalInput?.channels) && io.digitalInput.channels.length > 0
          ? io.digitalInput.channels
          : defaultDigital.channels,
      db: io.digitalInput?.db || defaultDigital.db,
    });
    setDoo({
      channels:
        Array.isArray(io.digitalOutput?.channels) && io.digitalOutput.channels.length > 0
          ? io.digitalOutput.channels
          : defaultDigitalOutput.channels,
    });
    setRelay({
      channels:
        Array.isArray(io.digitalRelay?.channels) && io.digitalRelay.channels.length > 0
          ? io.digitalRelay.channels
          : defaultRelay.channels,
    });
  }, [config]);

  const updateDIChannel = (index, patch) => {
    setDi((prev) => {
      const channels = [...prev.channels];
      channels[index] = { ...channels[index], ...patch };
      return { ...prev, channels };
    });
  };

  const updateDOChannel = (index, patch) => {
    setDoo((prev) => {
      const channels = [...prev.channels];
      channels[index] = { ...channels[index], ...patch };
      return { ...prev, channels };
    });
  };

  const updateRelayChannel = (index, patch) => {
    setRelay((prev) => {
      const channels = [...prev.channels];
      channels[index] = { ...channels[index], ...patch };
      return { ...prev, channels };
    });
  };

  const addDI = () => {
    setDi((prev) => ({
      ...prev,
      channels: [...prev.channels, { name: `DI${prev.channels.length + 1}`, enabled: false, pin: "" }],
    }));
  };

  const removeDI = (index) => {
    setDi((prev) => ({ ...prev, channels: prev.channels.filter((_, i) => i !== index) }));
  };

  const addDO = () => {
    setDoo((prev) => ({
      ...prev,
      channels: [...prev.channels, { name: `DO${prev.channels.length + 1}`, state: 0, pin: "" }],
    }));
  };

  const removeDO = (index) => {
    setDoo((prev) => ({ ...prev, channels: prev.channels.filter((_, i) => i !== index) }));
  };

  const addRelay = () => {
    setRelay((prev) => ({
      ...prev,
      channels: [...prev.channels, { name: `R${prev.channels.length + 1}`, enabled: false, pin: "", mode: "NO" }],
    }));
  };

  const removeRelay = (index) => {
    setRelay((prev) => ({ ...prev, channels: prev.channels.filter((_, i) => i !== index) }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isReadOnly) return;
    const fd = new FormData(e.target);
    const newConfig = JSON.parse(JSON.stringify(config));

    newConfig.ioSettings.digitalInput = {
      pollingInterval: Number(fd.get("digitalPollingInterval")) || di.pollingInterval,
      pollingIntervalUnit: fd.get("digitalIntervalUnit") || di.pollingIntervalUnit,
      channels: di.channels,
      db: {
        upload_local: fd.get("digital_upload_local") === "on",
        upload_cloud: fd.get("digital_upload_cloud") === "on",
        db_name: fd.get("digital_db_name") || "",
        table_name: fd.get("digital_table_name") || "",
      },
    };

    newConfig.ioSettings.digitalOutput = {
      channels: doo.channels,
    };

    newConfig.ioSettings.digitalRelay = {
      channels: relay.channels,
    };

    onSave(newConfig);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h3>Digital Input</h3>
      <label>
        Polling:
        <input
          name="digitalPollingInterval"
          type="number"
          min={1}
          value={di.pollingInterval}
          disabled={isReadOnly}
          onChange={(e) => setDi((prev) => ({ ...prev, pollingInterval: Number(e.target.value) }))}
          style={{ width: 70, marginLeft: 6 }}
        />
      </label>
      <label style={{ marginLeft: 10 }}>
        <select
          name="digitalIntervalUnit"
          value={di.pollingIntervalUnit}
          disabled={isReadOnly}
          onChange={(e) => setDi((prev) => ({ ...prev, pollingIntervalUnit: e.target.value }))}
        >
          <option value="Sec">Sec</option>
          <option value="Min">Min</option>
          <option value="Hour">Hour</option>
        </select>
      </label>

      <table className="channel-table" style={{ marginTop: 12, width: "100%" }}>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Name</th>
            <th>Pin</th>
            <th>Enable</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {di.channels.map((ch, i) => (
            <tr key={i}>
              <td>DI {i + 1}</td>
              <td>
                <input
                  name={`di_name_${i}`}
                  value={ch.name}
                  disabled={isReadOnly}
                  onChange={(e) => updateDIChannel(i, { name: e.target.value })}
                />
              </td>
              <td>
                <input
                  name={`di_pin_${i}`}
                  value={ch.pin}
                  placeholder="GPIO"
                  disabled={isReadOnly}
                  onChange={(e) => updateDIChannel(i, { pin: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  name={`di_enable_${i}`}
                  checked={ch.enabled}
                  disabled={isReadOnly}
                  onChange={(e) => updateDIChannel(i, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <button type="button" disabled={isReadOnly} onClick={() => removeDI(i)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="button-primary" disabled={isReadOnly} onClick={addDI}>
        + Add Digital Input
      </button>

      <h3 style={{ marginTop: 20 }}>Digital Output</h3>
      <table className="channel-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Name</th>
            <th>Pin</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {doo.channels.map((ch, i) => (
            <tr key={i}>
              <td>DO {i + 1}</td>
              <td>
                <input
                  name={`do_name_${i}`}
                  value={ch.name}
                  disabled={isReadOnly}
                  onChange={(e) => updateDOChannel(i, { name: e.target.value })}
                />
              </td>
              <td>
                <input
                  name={`do_pin_${i}`}
                  value={ch.pin}
                  placeholder="GPIO"
                  disabled={isReadOnly}
                  onChange={(e) => updateDOChannel(i, { pin: e.target.value })}
                />
              </td>
              <td>
                <select
                  name={`do_state_${i}`}
                  value={ch.state}
                  disabled={isReadOnly}
                  onChange={(e) => updateDOChannel(i, { state: Number(e.target.value) })}
                >
                  <option value={0}>LOW</option>
                  <option value={1}>HIGH</option>
                </select>
              </td>
              <td>
                <button type="button" disabled={isReadOnly} onClick={() => removeDO(i)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="button-primary" disabled={isReadOnly} onClick={addDO}>
        + Add Digital Output
      </button>

      <h3 style={{ marginTop: 20 }}>Relay Output</h3>
      <table className="channel-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Relay</th>
            <th>Name</th>
            <th>Pin</th>
            <th>Mode</th>
            <th>Enable</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {relay.channels.map((ch, i) => (
            <tr key={i}>
              <td>R{i + 1}</td>
              <td>
                <input
                  name={`ro_name_${i}`}
                  value={ch.name}
                  disabled={isReadOnly}
                  onChange={(e) => updateRelayChannel(i, { name: e.target.value })}
                />
              </td>
              <td>
                <input
                  name={`ro_pin_${i}`}
                  value={ch.pin}
                  placeholder="GPIO / Relay Addr"
                  disabled={isReadOnly}
                  onChange={(e) => updateRelayChannel(i, { pin: e.target.value })}
                />
              </td>
              <td>
                <select
                  name={`ro_mode_${i}`}
                  value={ch.mode}
                  disabled={isReadOnly}
                  onChange={(e) => updateRelayChannel(i, { mode: e.target.value })}
                >
                  <option value="NO">Normally Open</option>
                  <option value="NC">Normally Closed</option>
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  name={`ro_enable_${i}`}
                  checked={ch.enabled}
                  disabled={isReadOnly}
                  onChange={(e) => updateRelayChannel(i, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <button type="button" disabled={isReadOnly} onClick={() => removeRelay(i)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="button-primary" disabled={isReadOnly} onClick={addRelay}>
        + Add Relay
      </button>

      <DBSettings prefix="digital" db={di.db} role="admin" isReadOnly={isReadOnly} />
      <br />
      <button className="button-primary" type="submit" disabled={isReadOnly}>Save Digital Settings</button>
    </form>
  );
}

