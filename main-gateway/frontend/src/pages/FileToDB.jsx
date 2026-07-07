import React, { useState } from "react";

export default function FileToDB({ config, onSave, isReadOnly = false }) {
  const [enabled, setEnabled] = useState(true);

  const submit = (e) => {
    e.preventDefault();
    if (isReadOnly) return;
    alert("File-to-DB settings saved (demo)");
  };

  return (
    <div>
      <h2>File to DB</h2>
      <form onSubmit={submit}>
        <label>
          <input type="checkbox" checked={enabled} disabled={isReadOnly} onChange={(e) => setEnabled(e.target.checked)} /> Enable File to DB
        </label>
        <br /><br />
        <button className="button-primary" type="submit" disabled={isReadOnly}>Save</button>
      </form>
    </div>
  );
}
