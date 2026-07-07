import React, { useEffect, useState } from "react";
import DBSettings from "./DBSettings";

const getAnalogMin = (range) => (range && range.includes(":") ? range.split(":")[0] : "");
const getAnalogMax = (range) => {
  const matches = range?.match(/-?\d+(\.\d+)?/g);
  return matches && matches.length > 1 ? matches[1] : "";
};

const defaultAnalog = {
  pollingInterval: 5,
  pollingIntervalUnit: "Sec",
  channels: [
    { name: "AI1", enabled: false, mode: "0.-2.048V", range: "", address: "" },
  ],
  db: {
    upload_local: true,
    upload_cloud: false,
    db_name: "",
    table_name: "",
  },
};

const defaultAnalogOutput = {
  channels: [{ name: "AO1", enabled: false, mode: "0-10V", range: "", address: "" }],
};

export default function AnalogIO({ config, onSave, isReadOnly = false }) {
  const [analog, setAnalog] = useState(defaultAnalog);
  const [analogOutput, setAnalogOutput] = useState(defaultAnalogOutput);

  useEffect(() => {
    const io = config?.ioSettings || {};
    setAnalog({
      pollingInterval: io.analog?.pollingInterval ?? 5,
      pollingIntervalUnit: io.analog?.pollingIntervalUnit ?? "Sec",
      channels: Array.isArray(io.analog?.channels) && io.analog.channels.length > 0
        ? io.analog.channels
        : defaultAnalog.channels,
      db: io.analog?.db || defaultAnalog.db,
    });
    setAnalogOutput({
      channels: Array.isArray(io.analogOutput?.channels) && io.analogOutput.channels.length > 0
        ? io.analogOutput.channels
        : defaultAnalogOutput.channels,
    });
  }, [config]);

  const updateAIChannel = (index, patch) => {
    setAnalog((prev) => {
      const channels = [...prev.channels];
      channels[index] = { ...channels[index], ...patch };
      return { ...prev, channels };
    });
  };

  const updateAOChannel = (index, patch) => {
    setAnalogOutput((prev) => {
      const channels = [...prev.channels];
      channels[index] = { ...channels[index], ...patch };
      return { ...prev, channels };
    });
  };

  const addAI = () => {
    setAnalog((prev) => ({
      ...prev,
      channels: [...prev.channels, { name: `AI${prev.channels.length + 1}`, enabled: false, mode: "0.-2.048V", range: "", address: "" }],
    }));
  };

  const removeAI = (index) => {
    setAnalog((prev) => ({
      ...prev,
      channels: prev.channels.filter((_, i) => i !== index),
    }));
  };

  const addAO = () => {
    setAnalogOutput((prev) => ({
      ...prev,
      channels: [...prev.channels, { name: `AO${prev.channels.length + 1}`, enabled: false, mode: "0-10V", range: "", address: "" }],
    }));
  };

  const removeAO = (index) => {
    setAnalogOutput((prev) => ({ ...prev, channels: prev.channels.filter((_, i) => i !== index) }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isReadOnly) return;

    for (let i = 0; i < analog.channels.length; i += 1) {
      const min = getAnalogMin(analog.channels[i].range);
      const max = getAnalogMax(analog.channels[i].range);
      if (min !== "" && max !== "" && Number(min) >= Number(max)) {
        alert(`AI ${i + 1}: Process Min must be less than Process Max`);
        return;
      }
    }

    for (let i = 0; i < analogOutput.channels.length; i += 1) {
      const min = getAnalogMin(analogOutput.channels[i].range);
      const max = getAnalogMax(analogOutput.channels[i].range);
      if (min !== "" && max !== "" && Number(min) >= Number(max)) {
        alert(`AO ${i + 1}: Process Min must be less than Process Max`);
        return;
      }
    }

    const fd = new FormData(e.target);
    const newConfig = JSON.parse(JSON.stringify(config));
    newConfig.ioSettings.analog = {
      pollingInterval: Number(fd.get("pollingInterval")) || analog.pollingInterval,
      pollingIntervalUnit: fd.get("intervalUnit") || analog.pollingIntervalUnit,
      channels: analog.channels,
      db: {
        upload_local: fd.get("analog_upload_local") === "on",
        upload_cloud: fd.get("analog_upload_cloud") === "on",
        db_name: fd.get("analog_db_name") || "",
        table_name: fd.get("analog_table_name") || "",
      },
    };
    newConfig.ioSettings.analogOutput = {
      channels: analogOutput.channels,
    };

    onSave(newConfig);
  };

  const getChannelMin = (range) => (range && range.includes(":") ? range.split(":")[0] : "");
  const getChannelMax = (range) => {
    const parsed = range?.match(/-?\d+(\.\d+)?/g);
    return parsed && parsed.length > 1 ? parsed[1] : "";
  };

  return (
    <form onSubmit={handleSubmit}>
      <h3>Analog Input</h3>
      <div style={{ marginBottom: 12 }}>
        <label>
          <input
            type="radio"
            name="intervalUnit"
            value="Sec"
            defaultChecked={analog.pollingIntervalUnit === "Sec"}
            disabled={isReadOnly}
            onChange={() => setAnalog((p) => ({ ...p, pollingIntervalUnit: "Sec" }))}
          />
          Sec
        </label>
        <label style={{ marginLeft: 10 }}>
          <input
            type="radio"
            name="intervalUnit"
            value="Min"
            defaultChecked={analog.pollingIntervalUnit === "Min"}
            disabled={isReadOnly}
            onChange={() => setAnalog((p) => ({ ...p, pollingIntervalUnit: "Min" }))}
          />
          Min
        </label>
        <label style={{ marginLeft: 10 }}>
          <input
            type="radio"
            name="intervalUnit"
            value="Hour"
            defaultChecked={analog.pollingIntervalUnit === "Hour"}
            disabled={isReadOnly}
            onChange={() => setAnalog((p) => ({ ...p, pollingIntervalUnit: "Hour" }))}
          />
          Hour
        </label>
        &nbsp; Polling:
        <input
          type="number"
          name="pollingInterval"
          value={analog.pollingInterval}
          disabled={isReadOnly}
          onChange={(e) => setAnalog((p) => ({ ...p, pollingInterval: Number(e.target.value) }))}
          min={1}
          style={{ width: 70, marginLeft: 6 }}
        />
      </div>

      <table className="channel-table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Name</th>
            <th>Enable</th>
            <th>Electrical Mode</th>
            <th>Process Min</th>
            <th>Process Max</th>
            <th>Address</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {analog.channels.map((ch, i) => {
            const min = getChannelMin(ch.range);
            const max = getChannelMax(ch.range);
            return (
              <tr key={i}>
                <td>AI {i + 1}</td>
                <td>
                  <input
                    name={`ai_name_${i}`}
                    value={ch.name}
                    disabled={isReadOnly}
                    onChange={(e) => updateAIChannel(i, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    name={`ai_enable_${i}`}
                    checked={ch.enabled}
                    disabled={isReadOnly}
                    onChange={(e) => updateAIChannel(i, { enabled: e.target.checked })}
                  />
                </td>
                <td>
                  <select
                    name={`ai_mode_${i}`}
                    value={ch.mode}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      const mode = e.target.value;
                      const symbol = mode.includes("mA") ? "mA" : "V";
                      const [currentMin, currentMax] = [getChannelMin(ch.range), getChannelMax(ch.range)];
                      updateAIChannel(i, {
                        mode,
                        range:
                          currentMin !== "" && currentMax !== ""
                            ? `${currentMin}:${currentMax}${symbol}`
                            : "",
                      });
                    }}
                  >
                    <option value="0.-2.048V">0–2.048V</option>
                    <option value="4-20mA">4–20mA</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    name={`ai_min_${i}`}
                    value={min}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      const newMin = e.target.value;
                      const unit = ch.mode.includes("mA") ? "mA" : "V";
                      updateAIChannel(i, {
                        range: newMin !== "" && max !== "" ? `${newMin}:${max}${unit}` : `${newMin}:${max}${unit}`,
                      });
                    }}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    name={`ai_max_${i}`}
                    value={max}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      const newMax = e.target.value;
                      const unit = ch.mode.includes("mA") ? "mA" : "V";
                      updateAIChannel(i, {
                        range: min !== "" && newMax !== "" ? `${min}:${newMax}${unit}` : `${min}:${newMax}${unit}`,
                      });
                    }}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <input
                    name={`ai_address_${i}`}
                    value={ch.address}
                    placeholder="Addr"
                    disabled={isReadOnly}
                    onChange={(e) => updateAIChannel(i, { address: e.target.value })}
                  />
                </td>
                <td>
                  <button type="button" disabled={isReadOnly} onClick={() => removeAI(i)}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={addAI} disabled={isReadOnly} className="button-primary">
        + Add Analog Input
      </button>

      <h3 style={{ marginTop: 20 }}>Analog Output</h3>
      <table className="channel-table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Name</th>
            <th>Enable</th>
            <th>Mode</th>
            <th>Process Min</th>
            <th>Process Max</th>
            <th>Address</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {analogOutput.channels.map((ch, i) => {
            const min = getChannelMin(ch.range);
            const max = getChannelMax(ch.range);
            return (
              <tr key={i}>
                <td>AO {i + 1}</td>
                <td>
                  <input
                    name={`ao_name_${i}`}
                    value={ch.name}
                    disabled={isReadOnly}
                    onChange={(e) => updateAOChannel(i, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    name={`ao_enable_${i}`}
                    checked={ch.enabled}
                    disabled={isReadOnly}
                    onChange={(e) => updateAOChannel(i, { enabled: e.target.checked })}
                  />
                </td>
                <td>
                  <select
                    name={`ao_mode_${i}`}
                    value={ch.mode}
                    disabled={isReadOnly}
                    onChange={(e) => updateAOChannel(i, { mode: e.target.value })}
                  >
                    <option value="0-10V">0–10V</option>
                    <option value="4-20mA">4–20mA</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    name={`ao_min_${i}`}
                    value={min}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      const newMin = e.target.value;
                      const unit = ch.mode.includes("mA") ? "mA" : "V";
                      updateAOChannel(i, {
                        range: newMin !== "" && max !== "" ? `${newMin}:${max}${unit}` : `${newMin}:${max}${unit}`,
                      });
                    }}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    name={`ao_max_${i}`}
                    value={max}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      const newMax = e.target.value;
                      const unit = ch.mode.includes("mA") ? "mA" : "V";
                      updateAOChannel(i, {
                        range: min !== "" && newMax !== "" ? `${min}:${newMax}${unit}` : `${min}:${newMax}${unit}`,
                      });
                    }}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <input
                    name={`ao_address_${i}`}
                    value={ch.address}
                    disabled={isReadOnly}
                    onChange={(e) => updateAOChannel(i, { address: e.target.value })}
                  />
                </td>
                <td>
                  <button type="button" disabled={isReadOnly} onClick={() => removeAO(i)}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={addAO} disabled={isReadOnly} className="button-primary">
        + Add Analog Output
      </button>

      <DBSettings prefix="analog" db={analog.db} role="admin" isReadOnly={isReadOnly} />
      <br />
      <button className="button-primary" type="submit" disabled={isReadOnly}>
        Save
      </button>
    </form>
  );
}
