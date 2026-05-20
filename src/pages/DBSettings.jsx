import React from "react";

/**
 * DBSettings – reusable database settings block.
 *
 * Controlled mode (preferred): pass `onChange(field, value)` – inputs use
 *   checked / value and call onChange on every change.
 * Uncontrolled mode (legacy): omit `onChange` – inputs use defaultChecked /
 *   defaultValue and expose html name attributes for FormData reading.
 */
export default function DBSettings({ prefix, db, role, onChange, isReadOnly = false }) {
  const currentDb = db || {
    upload_local: true,
    upload_cloud: false,
    db_name: "",
    table_name: "",
  };

  const isPrivilegedRole = role === "admin" || role === "superadmin";
  const controlled = !!onChange;

  return (
    <div style={{ marginTop: 12, padding: 8, border: "1px solid #ccc" }}>
      <b>Database Settings</b>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginTop: 6,
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {controlled ? (
            <input
              type="checkbox"
              checked={!!currentDb.upload_local}
              disabled={isReadOnly}
              onChange={(e) => onChange("upload_local", e.target.checked)}
            />
          ) : (
            <input
              type="checkbox"
              name={`${prefix}_upload_local`}
              defaultChecked={!!currentDb.upload_local}
              disabled={isReadOnly}
            />
          )}
          Local DB
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {controlled ? (
            <input
              type="checkbox"
              checked={!!currentDb.upload_cloud}
              disabled={isReadOnly}
              onChange={(e) => onChange("upload_cloud", e.target.checked)}
            />
          ) : (
            <input
              type="checkbox"
              name={`${prefix}_upload_cloud`}
              defaultChecked={!!currentDb.upload_cloud}
              disabled={isReadOnly}
            />
          )}
          Cloud DB
        </label>

        {/* {isPrivilegedRole ? (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <b>Database Name</b>
              {controlled ? (
                <input
                  type="text"
                  value={currentDb.db_name || ""}
                  placeholder="Database name"
                  onChange={(e) => onChange("db_name", e.target.value)}
                  style={{ width: 140, marginLeft: 4 }}
                />
              ) : (
                <input
                  type="text"
                  name={`${prefix}_db_name`}
                  placeholder="Database name"
                  defaultValue={currentDb.db_name || "ifex_demo"}
                  style={{ width: 140, marginLeft: 4 }}
                />
              )}
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <b>Table Name</b>
              {controlled ? (
                <input
                  type="text"
                  value={currentDb.table_name || ""}
                  placeholder="Table name"
                  onChange={(e) => onChange("table_name", e.target.value)}
                  style={{ width: 140, marginLeft: 4 }}
                />
              ) : (
                <input
                  type="text"
                  name={`${prefix}_table_name`}
                  placeholder="Table name"
                  defaultValue={currentDb.table_name || ""}
                  style={{ width: 140, marginLeft: 4 }}
                />
              )}
            </label>
          </>
        ) : (
          <>
            <input type="hidden" name={`${prefix}_db_name`} value={currentDb.db_name || "ifex_demo"} readOnly />
            <input type="hidden" name={`${prefix}_table_name`} value={currentDb.table_name || ""} readOnly />
          </>
        )} */}
      </div>
    </div>
  );
}
