export function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

export function convertToSec(val, unit) {
  if (unit === "min") return val * 60;
  if (unit === "hour") return val * 3600;
  return val;
}

export function convertFromSec(sec, unit) {
  if (unit === "min") return sec / 60;
  if (unit === "hour") return sec / 3600;
  return sec;
}

// -----------------------------------------------------------------------------
// Siemens
// -----------------------------------------------------------------------------

export function normalizeSiemensRow(r) {
  return {
    content: r.content ?? "",
    DB_no: r.DB_no ?? 0,
    address: r.address ?? 0,
    type: r.type ?? "float",
    size: r.size ?? "",
    min: r.min ?? "",
    max: r.max ?? "",
    output_pct: r.output_pct ?? "",
    value: r.value ?? "",
    read: r.read !== false,
    write: r.write ?? false,
    status: r.status ?? "Unassigned",
  };
}

// -----------------------------------------------------------------------------
// Allen Bradley
// -----------------------------------------------------------------------------

export function normalizeAllenBradleyRow(r) {
  return {
    tag: r.tag ?? "",
    address: r.address ?? "",
    datatype: r.datatype ?? "FLOAT",
    length: r.length ?? 1,
    min: r.min ?? "",
    max: r.max ?? "",
    output_pct: r.output_pct ?? "",
    value: r.value ?? "",
    read: r.read !== false,
    write: r.write ?? false,
    status: r.status ?? "Unassigned",
  };
}

// -----------------------------------------------------------------------------
// Siemens PLC
// -----------------------------------------------------------------------------

function normalizeSiemensPLC(plc) {
  return {
    cred: {
      ip: plc.cred?.ip ?? "192.168.0.1",
      rack: plc.cred?.rack ?? 0,
      slot: plc.cred?.slot ?? 2,
    },
    address_access: {
      read: (plc.address_access?.read ?? []).map(normalizeSiemensRow),
    },
    data_freq_sec: plc.data_freq_sec ?? 1,
    data_freq_unit: plc.data_freq_unit ?? "sec",
    Database: {
      upload_local: plc.Database?.upload_local ?? true,
      upload_cloud: plc.Database?.upload_cloud ?? false,
      db_name: plc.Database?.db_name ?? "test",
      table_name: plc.Database?.table_name ?? "",
    },
  };
}

// -----------------------------------------------------------------------------
// Allen Bradley PLC
// -----------------------------------------------------------------------------

function normalizeAllenBradleyPLC(plc) {
  return {
    cred: {
      ip: plc.cred?.ip ?? "192.168.1.200",
      port: plc.cred?.port ?? 44818,
    },
    address_access: {
      read: (plc.address_access?.read ?? []).map(normalizeAllenBradleyRow),
    },
    data_freq_sec: plc.data_freq_sec ?? 1,
    data_freq_unit: plc.data_freq_unit ?? "sec",
    Database: {
      upload_local: plc.Database?.upload_local ?? true,
      upload_cloud: plc.Database?.upload_cloud ?? false,
      db_name: plc.Database?.db_name ?? "test",
      table_name: plc.Database?.table_name ?? "",
    },
  };
}

// -----------------------------------------------------------------------------
// PLC Entry
// -----------------------------------------------------------------------------

export function normalizePlcEntry(entry) {
  const plcType = entry.plcType ?? "Siemens";
  const rawPLC = entry.PLC ?? {};
  const PLC =
    plcType === "Siemens"
      ? normalizeSiemensPLC(rawPLC)
      : normalizeAllenBradleyPLC(rawPLC);

  return {
    plcType,
    isExpanded: entry.isExpanded ?? true,
    enabled: entry.enabled ?? true,
    PLC,
  };
}

// -----------------------------------------------------------------------------
// Protocol classification — single source of truth
// -----------------------------------------------------------------------------

function classifyProtocol(protocol) {
  const p = String(protocol ?? "").trim().toUpperCase();
  if (p === "HTTP" || p === "HTTPS" || p === "HTTP / HTTPS") return "http";
  if (p === "OPC UA") return "opcua";
  if (p === "MODBUS TCP") return "modbus";
  if (p === "FILE BASED SHARING" || p === "FILE SHARING") return "file";
  return "http"; // default
}

// -----------------------------------------------------------------------------
// SCADA / HMI sub-normalizers
// -----------------------------------------------------------------------------

function normalizeHttpTag(t) {
  return {
    tag_name: t?.tag_name ?? "",
    data_type: t?.data_type ?? "STRING",
  };
}

function normalizeHttpRequest(r) {
  return {
    name: r?.name ?? "",
    method: r?.method ?? "GET",
    path: r?.path ?? "",
    tags: Array.isArray(r?.tags) ? r.tags.map(normalizeHttpTag) : [],
  };
}

function normalizeOpcNode(n) {
  return {
    label: n?.label ?? "",
    node_id: n?.node_id ?? "",
    data_type: n?.data_type ?? "STRING",
  };
}

function normalizeFileColumn(c) {
  return {
    column_name: c?.column_name ?? "",
    data_type: c?.data_type ?? "STRING",
  };
}

function normalizeModbusRegister(r) {
  return {
    tag_name: r?.tag_name ?? "",
    address: r?.address ?? "",
    data_type: r?.data_type ?? "INT",
    length: r?.length ?? 1,
  };
}

// -----------------------------------------------------------------------------
// Connection — keyed by classified protocol
// -----------------------------------------------------------------------------

function normalizeConnection(d) {
  const kind = classifyProtocol(d.protocol);
  const c = d.connection ?? {};

  if (kind === "http") {
    return {
      base_url: c.base_url ?? "",
      verify_ssl: c.verify_ssl ?? false,
      timeout_seconds: c.timeout_seconds ?? 10,
    };
  }

  if (kind === "opcua") {
    return {
      endpoint_url: c.endpoint_url ?? "",
      security_mode: c.security_mode ?? "None",
      security_policy: c.security_policy ?? "None",
      certificate_path: c.certificate_path ?? "",
      private_key_path: c.private_key_path ?? "",
    };
  }

  if (kind === "modbus") {
    return {
      ip: c.ip ?? "",
      port: c.port ?? 502,
    };
  }

  if (kind === "file") {
    return {
      file_location: c.file_location ?? "",
      username: c.username ?? "",
      password: c.password ?? "",
    };
  }

  return {};
}

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

function normalizeAuthentication(d) {
  return {
    type: d.authentication?.type ?? "username_password",
    username: d.authentication?.username ?? d.username ?? "",
    password: d.authentication?.password ?? d.password ?? "",
    bearer_token: d.authentication?.bearer_token ?? "",
  };
}

// -----------------------------------------------------------------------------
// Data Source — keyed by classified protocol
// -----------------------------------------------------------------------------

function normalizeDataSource(d) {
  const kind = classifyProtocol(d.protocol);
  const ds = d.data_source ?? {};

  if (kind === "http") {
    return {
      requests: Array.isArray(ds.requests)
        ? ds.requests.map(normalizeHttpRequest)
        : [],
    };
  }

  if (kind === "opcua") {
    return {
      mode: ds.mode ?? "subscription",
      publishing_interval: ds.publishing_interval ?? 1000,
      polling_interval_ms: ds.polling_interval_ms ?? 1000,
      nodes: Array.isArray(ds.nodes) ? ds.nodes.map(normalizeOpcNode) : [],
    };
  }

  if (kind === "modbus") {
    return {
      registers: Array.isArray(ds.registers)
        ? ds.registers.map(normalizeModbusRegister)
        : [],
    };
  }

  if (kind === "file") {
    return {
      columns: Array.isArray(ds.columns)
        ? ds.columns.map(normalizeFileColumn)
        : [],
    };
  }

  return {};
}

// -----------------------------------------------------------------------------
// Base Device
// -----------------------------------------------------------------------------

function normalizeBaseDevice(d) {
  return {
    label: d.label ?? "",
    enabled: d.enabled ?? true,
    os: d.os ?? "Windows",
    protocol: d.protocol ?? "HTTP / HTTPS",
    connection: normalizeConnection(d),
    authentication: normalizeAuthentication(d),
    data_source: normalizeDataSource(d),
  };
}

// -----------------------------------------------------------------------------
// SCADA Device
// -----------------------------------------------------------------------------

export function normalizeScadaDevice(d) {
  return {
    ...normalizeBaseDevice(d ?? {}),
    scada_software: d?.scada_software ?? "",
  };
}

// -----------------------------------------------------------------------------
// HMI Device
// -----------------------------------------------------------------------------

export function normalizeHmiDevice(d) {
  return normalizeBaseDevice(d ?? {});
}

// -----------------------------------------------------------------------------
// Root Config
// -----------------------------------------------------------------------------

export function ensureBase(cfg) {
  const next = { ...(cfg ?? {}) };
  next.plc_configurations = (next.plc_configurations ?? []).map(normalizePlcEntry);
  next.scada_configurations = (next.scada_configurations ?? []).map(normalizeScadaDevice);
  next.hmi_configurations = (next.hmi_configurations ?? []).map(normalizeHmiDevice);
  return next;
}