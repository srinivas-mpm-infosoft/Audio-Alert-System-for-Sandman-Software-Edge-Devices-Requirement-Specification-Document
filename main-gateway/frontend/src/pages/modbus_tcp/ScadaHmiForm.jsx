// import React from "react";
// import { X } from "lucide-react";

// const inp =
//   "w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400";

// const th =
//   "text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2 whitespace-nowrap";

// const td = "px-2 py-1.5 align-middle";

// const DATA_TYPES = [
//   "STRING",
//   "INT",
//   "FLOAT",
//   "BOOL",
//   "DATETIME",
// ];

// const HTTP_METHODS = [
//   "GET",
//   "POST",
//   "PUT",
//   "DELETE",
// ];

// export default function ScadaHmiForm({
//   device,
//   onChange,
//   isReadOnly,
//   isScada = false,
// }) {
//   const protocol = device.protocol ?? "HTTP";

//   const isHttp =
//     protocol === "HTTP" || protocol === "HTTPS";

//   const isOpcUa = protocol === "OPC UA";

//   // ---------------------------------------------------------------------------
//   // Generic updater
//   // ---------------------------------------------------------------------------

//   const upd = (field, value) =>
//     onChange((d) => ({
//       ...d,
//       [field]: value,
//     }));

//   // ---------------------------------------------------------------------------
//   // Nested updater
//   // ---------------------------------------------------------------------------

//   const updNested = (section, field, value) =>
//     onChange((d) => ({
//       ...d,
//       [section]: {
//         ...(d[section] ?? {}),
//         [field]: value,
//       },
//     }));

//   // ---------------------------------------------------------------------------
//   // Data source updater
//   // ---------------------------------------------------------------------------

//   const updDataSource = (field, value) =>
//     onChange((d) => ({
//       ...d,
//       data_source: {
//         ...(d.data_source ?? {}),
//         [field]: value,
//       },
//     }));

//   // ---------------------------------------------------------------------------
//   // HTTP Endpoints
//   // ---------------------------------------------------------------------------

//   const endpoints =
//     device.data_source?.endpoints ?? [];

//   const addEndpoint = () =>
//     updDataSource("endpoints", [
//       ...endpoints,
//       {
//         name: "",
//         method: "GET",
//         path: "",
//       },
//     ]);

//   const updEndpoint = (i, field, value) => {
//     const next = [...endpoints];
//     next[i] = {
//       ...next[i],
//       [field]: value,
//     };

//     updDataSource("endpoints", next);
//   };

//   const removeEndpoint = (i) =>
//     updDataSource(
//       "endpoints",
//       endpoints.filter((_, idx) => idx !== i)
//     );

//   // ---------------------------------------------------------------------------
//   // HTTP Mapping
//   // ---------------------------------------------------------------------------

//   const mapping =
//     device.data_source?.mapping ?? [];

//   const addMapping = () =>
//     updDataSource("mapping", [
//       ...mapping,
//       {
//         field_name: "",
//         data_type: "STRING",
//         source: "",
//       },
//     ]);

//   const updMapping = (i, field, value) => {
//     const next = [...mapping];

//     next[i] = {
//       ...next[i],
//       [field]: value,
//     };

//     updDataSource("mapping", next);
//   };

//   const removeMapping = (i) =>
//     updDataSource(
//       "mapping",
//       mapping.filter((_, idx) => idx !== i)
//     );

//   // ---------------------------------------------------------------------------
//   // OPC UA Nodes
//   // ---------------------------------------------------------------------------

//   const nodes =
//     device.data_source?.nodes ?? [];

//   const addNode = () =>
//     updDataSource("nodes", [
//       ...nodes,
//       {
//         label: "",
//         node_id: "",
//         data_type: "STRING",
//       },
//     ]);

//   const updNode = (i, field, value) => {
//     const next = [...nodes];

//     next[i] = {
//       ...next[i],
//       [field]: value,
//     };

//     updDataSource("nodes", next);
//   };

//   const removeNode = (i) =>
//     updDataSource(
//       "nodes",
//       nodes.filter((_, idx) => idx !== i)
//     );

//   return (
//     <div className="space-y-5">

//       {/* ------------------------------------------------------------------ */}
//       {/* System */}
//       {/* ------------------------------------------------------------------ */}

//       <div>
//         <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
//           System
//         </span>

//         <div className="grid grid-cols-2 gap-3">

//           <div>
//             <label className="text-[10px] text-slate-400 mb-1 block">
//               OS
//             </label>

//             <select
//               value={device.os ?? "Windows"}
//               disabled={isReadOnly}
//               onChange={(e) =>
//                 upd("os", e.target.value)
//               }
//               className={inp}
//             >
//               <option>Windows</option>
//               <option>Linux</option>
//             </select>
//           </div>

//           <div>
//             <label className="text-[10px] text-slate-400 mb-1 block">
//               Protocol
//             </label>

//             <select
//               value={protocol}
//               disabled={isReadOnly}
//               onChange={(e) =>
//                 upd("protocol", e.target.value)
//               }
//               className={inp}
//             >
//               <option>HTTP</option>
//               <option>HTTPS</option>
//               <option>OPC UA</option>
//             </select>
//           </div>

//           {isScada && (
//             <div className="col-span-2">
//               <label className="text-[10px] text-slate-400 mb-1 block">
//                 SCADA Software
//               </label>

//               <input
//                 type="text"
//                 value={device.scada_software ?? ""}
//                 disabled={isReadOnly}
//                 placeholder="e.g. WinCC"
//                 onChange={(e) =>
//                   upd(
//                     "scada_software",
//                     e.target.value
//                   )
//                 }
//                 className={inp}
//               />
//             </div>
//           )}

//         </div>
//       </div>

//       {/* ------------------------------------------------------------------ */}
//       {/* Authentication */}
//       {/* ------------------------------------------------------------------ */}

//       <div>
//         <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
//           Authentication
//         </span>

//         <div className="grid grid-cols-2 gap-3">

//           <div>
//             <label className="text-[10px] text-slate-400 mb-1 block">
//               Auth Type
//             </label>

//             <select
//               value={
//                 device.authentication?.type ??
//                 "username_password"
//               }
//               disabled={isReadOnly}
//               onChange={(e) =>
//                 updNested(
//                   "authentication",
//                   "type",
//                   e.target.value
//                 )
//               }
//               className={inp}
//             >
//               <option value="none">None</option>
//               <option value="basic">Basic</option>
//               <option value="username_password">
//                 Username/Password
//               </option>
//               <option value="bearer">
//                 Bearer Token
//               </option>
//             </select>
//           </div>

//           <div />

//           <div>
//             <label className="text-[10px] text-slate-400 mb-1 block">
//               Username
//             </label>

//             <input
//               type="text"
//               value={
//                 device.authentication?.username ??
//                 ""
//               }
//               disabled={isReadOnly}
//               onChange={(e) =>
//                 updNested(
//                   "authentication",
//                   "username",
//                   e.target.value
//                 )
//               }
//               className={inp}
//             />
//           </div>

//           <div>
//             <label className="text-[10px] text-slate-400 mb-1 block">
//               Password
//             </label>

//             <input
//               type="password"
//               value={
//                 device.authentication?.password ??
//                 ""
//               }
//               disabled={isReadOnly}
//               onChange={(e) =>
//                 updNested(
//                   "authentication",
//                   "password",
//                   e.target.value
//                 )
//               }
//               className={inp}
//             />
//           </div>

//         </div>
//       </div>

//       {/* ------------------------------------------------------------------ */}
//       {/* HTTP / HTTPS */}
//       {/* ------------------------------------------------------------------ */}

//       {isHttp && (
//         <>
//           <div>
//             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
//               HTTP Connection
//             </span>

//             <div className="grid grid-cols-2 gap-3">

//               <div>
//                 <label className="text-[10px] text-slate-400 mb-1 block">
//                   IP Address
//                 </label>

//                 <input
//                   type="text"
//                   value={
//                     device.connection?.ip ?? ""
//                   }
//                   disabled={isReadOnly}
//                   onChange={(e) =>
//                     updNested(
//                       "connection",
//                       "ip",
//                       e.target.value
//                     )
//                   }
//                   className={inp}
//                 />
//               </div>

//               <div>
//                 <label className="text-[10px] text-slate-400 mb-1 block">
//                   Port
//                 </label>

//                 <input
//                   type="number"
//                   value={
//                     device.connection?.port ?? 80
//                   }
//                   disabled={isReadOnly}
//                   onChange={(e) =>
//                     updNested(
//                       "connection",
//                       "port",
//                       Number(e.target.value)
//                     )
//                   }
//                   className={inp}
//                 />
//               </div>

//               <div className="col-span-2">
//                 <label className="text-[10px] text-slate-400 mb-1 block">
//                   Base URL
//                 </label>

//                 <input
//                   type="text"
//                   value={
//                     device.connection?.base_url ??
//                     ""
//                   }
//                   disabled={isReadOnly}
//                   onChange={(e) =>
//                     updNested(
//                       "connection",
//                       "base_url",
//                       e.target.value
//                     )
//                   }
//                   className={inp}
//                 />
//               </div>

//             </div>
//           </div>

//           {/* Endpoints */}

//           <div>
//             <div className="flex items-center justify-between mb-3">
//               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
//                 HTTP Endpoints
//               </span>
//             </div>

//             <div className="overflow-x-auto rounded-xl border border-slate-200">
//               <table className="w-full text-xs">
//                 <thead className="bg-slate-50 border-b border-slate-200">
//                   <tr>
//                     {[
//                       "Name",
//                       "Method",
//                       "Path",
//                       "",
//                     ].map((h) => (
//                       <th key={h} className={th}>
//                         {h}
//                       </th>
//                     ))}
//                   </tr>
//                 </thead>

//                 <tbody className="divide-y divide-slate-100 bg-white">

//                   {endpoints.map((ep, i) => (
//                     <tr key={i}>

//                       <td className={td}>
//                         <input
//                           value={ep.name ?? ""}
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updEndpoint(
//                               i,
//                               "name",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         />
//                       </td>

//                       <td className={td}>
//                         <select
//                           value={ep.method ?? "GET"}
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updEndpoint(
//                               i,
//                               "method",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         >
//                           {HTTP_METHODS.map((m) => (
//                             <option key={m}>
//                               {m}
//                             </option>
//                           ))}
//                         </select>
//                       </td>

//                       <td className={td}>
//                         <input
//                           value={ep.path ?? ""}
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updEndpoint(
//                               i,
//                               "path",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         />
//                       </td>

//                       <td className={td}>
//                         <button
//                           type="button"
//                           disabled={isReadOnly}
//                           onClick={() =>
//                             removeEndpoint(i)
//                           }
//                         >
//                           <X size={12} />
//                         </button>
//                       </td>

//                     </tr>
//                   ))}

//                 </tbody>
//               </table>
//             </div>

//             <button
//               type="button"
//               disabled={isReadOnly}
//               onClick={addEndpoint}
//               className="mt-2 w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs"
//             >
//               + Add Endpoint
//             </button>
//           </div>

//           {/* Mapping */}

//           <div>
//             <div className="flex items-center justify-between mb-3">
//               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
//                 Data Mapping
//               </span>
//             </div>

//             <div className="overflow-x-auto rounded-xl border border-slate-200">

//               <table className="w-full text-xs">

//                 <thead className="bg-slate-50 border-b border-slate-200">
//                   <tr>
//                     {[
//                       "Field",
//                       "Type",
//                       "Source",
//                       "",
//                     ].map((h) => (
//                       <th key={h} className={th}>
//                         {h}
//                       </th>
//                     ))}
//                   </tr>
//                 </thead>

//                 <tbody className="divide-y divide-slate-100 bg-white">

//                   {mapping.map((m, i) => (
//                     <tr key={i}>

//                       <td className={td}>
//                         <input
//                           value={
//                             m.field_name ?? ""
//                           }
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updMapping(
//                               i,
//                               "field_name",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         />
//                       </td>

//                       <td className={td}>
//                         <select
//                           value={
//                             m.data_type ??
//                             "STRING"
//                           }
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updMapping(
//                               i,
//                               "data_type",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         >
//                           {DATA_TYPES.map((t) => (
//                             <option key={t}>
//                               {t}
//                             </option>
//                           ))}
//                         </select>
//                       </td>

//                       <td className={td}>
//                         <input
//                           value={m.source ?? ""}
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updMapping(
//                               i,
//                               "source",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         />
//                       </td>

//                       <td className={td}>
//                         <button
//                           type="button"
//                           disabled={isReadOnly}
//                           onClick={() =>
//                             removeMapping(i)
//                           }
//                         >
//                           <X size={12} />
//                         </button>
//                       </td>

//                     </tr>
//                   ))}

//                 </tbody>
//               </table>

//             </div>

//             <button
//               type="button"
//               disabled={isReadOnly}
//               onClick={addMapping}
//               className="mt-2 w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs"
//             >
//               + Add Mapping
//             </button>
//           </div>
//         </>
//       )}

//       {/* ------------------------------------------------------------------ */}
//       {/* OPC UA */}
//       {/* ------------------------------------------------------------------ */}

//       {isOpcUa && (
//         <>
//           <div>
//             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
//               OPC UA Connection
//             </span>

//             <div className="grid grid-cols-2 gap-3">

//               <div className="col-span-2">
//                 <label className="text-[10px] text-slate-400 mb-1 block">
//                   Endpoint URL
//                 </label>

//                 <input
//                   type="text"
//                   value={
//                     device.connection
//                       ?.endpoint_url ?? ""
//                   }
//                   disabled={isReadOnly}
//                   onChange={(e) =>
//                     updNested(
//                       "connection",
//                       "endpoint_url",
//                       e.target.value
//                     )
//                   }
//                   className={inp}
//                 />
//               </div>

//               <div>
//                 <label className="text-[10px] text-slate-400 mb-1 block">
//                   Security Mode
//                 </label>

//                 <select
//                   value={
//                     device.connection
//                       ?.security_mode ??
//                     "None"
//                   }
//                   disabled={isReadOnly}
//                   onChange={(e) =>
//                     updNested(
//                       "connection",
//                       "security_mode",
//                       e.target.value
//                     )
//                   }
//                   className={inp}
//                 >
//                   <option>None</option>
//                   <option>Sign</option>
//                   <option>
//                     SignAndEncrypt
//                   </option>
//                 </select>
//               </div>

//               <div>
//                 <label className="text-[10px] text-slate-400 mb-1 block">
//                   Security Policy
//                 </label>

//                 <select
//                   value={
//                     device.connection
//                       ?.security_policy ??
//                     "None"
//                   }
//                   disabled={isReadOnly}
//                   onChange={(e) =>
//                     updNested(
//                       "connection",
//                       "security_policy",
//                       e.target.value
//                     )
//                   }
//                   className={inp}
//                 >
//                   <option>None</option>
//                   <option>
//                     Basic256Sha256
//                   </option>
//                 </select>
//               </div>

//             </div>
//           </div>

//           {/* Nodes */}

//           <div>
//             <div className="flex items-center justify-between mb-3">
//               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
//                 OPC UA Nodes
//               </span>
//             </div>

//             <div className="overflow-x-auto rounded-xl border border-slate-200">

//               <table className="w-full text-xs">

//                 <thead className="bg-slate-50 border-b border-slate-200">
//                   <tr>
//                     {[
//                       "Label",
//                       "Node ID",
//                       "Type",
//                       "",
//                     ].map((h) => (
//                       <th key={h} className={th}>
//                         {h}
//                       </th>
//                     ))}
//                   </tr>
//                 </thead>

//                 <tbody className="divide-y divide-slate-100 bg-white">

//                   {nodes.map((n, i) => (
//                     <tr key={i}>

//                       <td className={td}>
//                         <input
//                           value={n.label ?? ""}
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updNode(
//                               i,
//                               "label",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         />
//                       </td>

//                       <td className={td}>
//                         <input
//                           value={
//                             n.node_id ?? ""
//                           }
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updNode(
//                               i,
//                               "node_id",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         />
//                       </td>

//                       <td className={td}>
//                         <select
//                           value={
//                             n.data_type ??
//                             "STRING"
//                           }
//                           disabled={isReadOnly}
//                           onChange={(e) =>
//                             updNode(
//                               i,
//                               "data_type",
//                               e.target.value
//                             )
//                           }
//                           className={inp}
//                         >
//                           {DATA_TYPES.map((t) => (
//                             <option key={t}>
//                               {t}
//                             </option>
//                           ))}
//                         </select>
//                       </td>

//                       <td className={td}>
//                         <button
//                           type="button"
//                           disabled={isReadOnly}
//                           onClick={() =>
//                             removeNode(i)
//                           }
//                         >
//                           <X size={12} />
//                         </button>
//                       </td>

//                     </tr>
//                   ))}

//                 </tbody>

//               </table>

//             </div>

//             <button
//               type="button"
//               disabled={isReadOnly}
//               onClick={addNode}
//               className="mt-2 w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs"
//             >
//               + Add Node
//             </button>
//           </div>
//         </>
//       )}
//     </div>
//   );
// }


import React from "react";
import { X } from "lucide-react";

const inp =
  "w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400";

const th =
  "text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2 whitespace-nowrap";

const td = "px-2 py-1.5 align-middle";

const DATA_TYPES = ["STRING", "INT", "FLOAT", "BOOL", "DATETIME"];

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"];

export default function ScadaHmiForm({
  device,
  onChange,
  isReadOnly,
  isScada = false,
}) {
  // ---------------------------------------------------------------------------
  // Protocols
  // ---------------------------------------------------------------------------

  const protocol = String(device?.protocol ?? "HTTP / HTTPS");
  const normalizedProtocol = protocol.trim().toUpperCase();

  const isHttp =
    normalizedProtocol === "HTTP" ||
    normalizedProtocol === "HTTPS" ||
    normalizedProtocol === "HTTP / HTTPS";

  const isOpcUa = normalizedProtocol === "OPC UA";

  const isFileBased =
    normalizedProtocol === "FILE BASED SHARING" ||
    normalizedProtocol === "FILE SHARING";

  const isModbusTcp = normalizedProtocol === "MODBUS TCP";

  // ---------------------------------------------------------------------------
  // Generic updaters
  // ---------------------------------------------------------------------------

  const upd = (field, value) =>
    onChange((d) => ({ ...d, [field]: value }));

  const updNested = (section, field, value) =>
    onChange((d) => ({
      ...d,
      [section]: { ...(d[section] ?? {}), [field]: value },
    }));

  const updDataSource = (field, value) =>
    onChange((d) => ({
      ...d,
      data_source: { ...(d.data_source ?? {}), [field]: value },
    }));

  // ---------------------------------------------------------------------------
  // HTTP Requests — normalize FIRST, then derive everything from normalized
  // ---------------------------------------------------------------------------

  const rawRequests = Array.isArray(device?.data_source?.requests)
    ? device.data_source.requests
    : [];

  const normalizedRequests = rawRequests.map((req) => ({
    name: req?.name ?? "",
    method: req?.method ?? "GET",
    path: req?.path ?? "",
    tags: Array.isArray(req?.tags)
      ? req.tags.map((t) => ({
          tag_name: t?.tag_name ?? "",
          data_type: t?.data_type ?? "STRING",
        }))
      : [],
  }));

  const addRequest = () =>
    updDataSource("requests", [
      ...normalizedRequests,
      { name: "", method: "GET", path: "", tags: [] },
    ]);

  const updRequest = (i, field, value) => {
    const next = normalizedRequests.map((r, idx) =>
      idx === i ? { ...r, [field]: value } : r,
    );
    updDataSource("requests", next);
  };

  const removeRequest = (i) =>
    updDataSource(
      "requests",
      normalizedRequests.filter((_, idx) => idx !== i),
    );

  const addTag = (reqIdx) => {
    const next = normalizedRequests.map((r, idx) =>
      idx === reqIdx
        ? { ...r, tags: [...r.tags, { tag_name: "", data_type: "STRING" }] }
        : r,
    );
    updDataSource("requests", next);
  };

  const updTag = (reqIdx, tagIdx, field, value) => {
    const next = normalizedRequests.map((r, idx) =>
      idx === reqIdx
        ? {
            ...r,
            tags: r.tags.map((t, ti) =>
              ti === tagIdx ? { ...t, [field]: value } : t,
            ),
          }
        : r,
    );
    updDataSource("requests", next);
  };

  const removeTag = (reqIdx, tagIdx) => {
    const next = normalizedRequests.map((r, idx) =>
      idx === reqIdx
        ? { ...r, tags: r.tags.filter((_, ti) => ti !== tagIdx) }
        : r,
    );
    updDataSource("requests", next);
  };

  // ---------------------------------------------------------------------------
  // OPC UA Nodes
  // ---------------------------------------------------------------------------

  const nodes = Array.isArray(device?.data_source?.nodes)
    ? device.data_source.nodes
    : [];

  const addNode = () =>
    updDataSource("nodes", [
      ...nodes,
      { label: "", node_id: "", data_type: "STRING" },
    ]);

  const updNode = (i, field, value) => {
    const next = nodes.map((n, idx) =>
      idx === i ? { ...n, [field]: value } : n,
    );
    updDataSource("nodes", next);
  };

  const removeNode = (i) =>
    updDataSource(
      "nodes",
      nodes.filter((_, idx) => idx !== i),
    );

  // ---------------------------------------------------------------------------
  // File Columns
  // ---------------------------------------------------------------------------

  const columns = Array.isArray(device?.data_source?.columns)
    ? device.data_source.columns
    : [];

  const addColumn = () =>
    updDataSource("columns", [
      ...columns,
      { column_name: "", data_type: "STRING" },
    ]);

  const updColumn = (i, field, value) => {
    const next = columns.map((c, idx) =>
      idx === i ? { ...c, [field]: value } : c,
    );
    updDataSource("columns", next);
  };

  const removeColumn = (i) =>
    updDataSource(
      "columns",
      columns.filter((_, idx) => idx !== i),
    );

  // ---------------------------------------------------------------------------
  // Modbus Registers
  // ---------------------------------------------------------------------------

  const registers = Array.isArray(device?.data_source?.registers)
    ? device.data_source.registers
    : [];

  const addRegister = () =>
    updDataSource("registers", [
      ...registers,
      { tag_name: "", address: "", data_type: "INT", length: 1 },
    ]);

  const updRegister = (i, field, value) => {
    const next = registers.map((r, idx) =>
      idx === i ? { ...r, [field]: value } : r,
    );
    updDataSource("registers", next);
  };

  const removeRegister = (i) =>
    updDataSource(
      "registers",
      registers.filter((_, idx) => idx !== i),
    );

  return (
    <div className="space-y-5">
      {/* System */}
      <div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
          System
        </span>

        <div className="grid grid-cols-2 gap-3">
          <div className="hidden">
            <label className="text-[10px] text-slate-400 mb-1 block">OS</label>
            <select
              value={device.os ?? "Windows"}
              disabled={isReadOnly}
              onChange={(e) => upd("os", e.target.value)}
              className={inp}>
              <option>Windows</option>
              <option>Linux</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 mb-1 block">
              Protocol
            </label>
            <select
              value={
                isHttp
                  ? "HTTP / HTTPS"
                  : isOpcUa
                    ? "OPC UA"
                    : isFileBased
                      ? "File Based Sharing"
                      : isModbusTcp
                        ? "Modbus TCP"
                        : "HTTP / HTTPS"
              }
              disabled={isReadOnly}
              onChange={(e) => upd("protocol", e.target.value)}
              className={inp}>
              <option>HTTP / HTTPS</option>
              <option>OPC UA</option>
              <option>File Based Sharing</option>
              <option>Ethernet TCP/IP</option>
            </select>
          </div>
        </div>
      </div>

      {/* HTTP / HTTPS */}
      {isHttp && (
        <>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
              HTTP Connection
            </span>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] text-slate-400 mb-1 block">
                  Base URL
                </label>
                <input
                  type="text"
                  value={device.connection?.base_url ?? ""}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    updNested("connection", "base_url", e.target.value)
                  }
                  className={inp}
                />
              </div>
            </div>
          </div>

          {/* Requests */}
          <div className="space-y-4">
            {normalizedRequests.map((req, reqIdx) => (
              <div
                key={reqIdx}
                className="border border-slate-200 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">
                    Request {reqIdx + 1}
                  </span>
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => removeRequest(reqIdx)}>
                    <X size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">
                      Name
                    </label>
                    <input
                      value={req.name}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        updRequest(reqIdx, "name", e.target.value)
                      }
                      className={inp}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">
                      Method
                    </label>
                    <select
                      value={req.method}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        updRequest(reqIdx, "method", e.target.value)
                      }
                      className={inp}>
                      {HTTP_METHODS.map((method) => (
                        <option key={method}>{method}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">
                      Path
                    </label>
                    <input
                      value={req.path}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        updRequest(reqIdx, "path", e.target.value)
                      }
                      className={inp}
                    />
                  </div>
                </div>

                {/* Tags */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {["Tag Name", "Data Type", ""].map((h) => (
                          <th key={h} className={th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {req.tags.length === 0 && (
                        <tr>
                          <td
                            colSpan={3}
                            className="text-center py-4 text-slate-400 italic text-xs">
                            No tags configured.
                          </td>
                        </tr>
                      )}
                      {req.tags.map((tag, tagIdx) => (
                        <tr key={tagIdx}>
                          <td className={td}>
                            <input
                              value={tag.tag_name}
                              disabled={isReadOnly}
                              onChange={(e) =>
                                updTag(
                                  reqIdx,
                                  tagIdx,
                                  "tag_name",
                                  e.target.value,
                                )
                              }
                              className={inp}
                            />
                          </td>
                          <td className={td}>
                            <select
                              value={tag.data_type}
                              disabled={isReadOnly}
                              onChange={(e) =>
                                updTag(
                                  reqIdx,
                                  tagIdx,
                                  "data_type",
                                  e.target.value,
                                )
                              }
                              className={inp}>
                              {DATA_TYPES.map((type) => (
                                <option key={type}>{type}</option>
                              ))}
                            </select>
                          </td>
                          <td className={td}>
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => removeTag(reqIdx, tagIdx)}>
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => addTag(reqIdx)}
                  className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs">
                  + Add Tag
                </button>
              </div>
            ))}

            <button
              type="button"
              disabled={isReadOnly}
              onClick={addRequest}
              className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs">
              + Add Request
            </button>
          </div>
        </>
      )}

      {/* OPC UA */}
      {isOpcUa && (
        <>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
              OPC UA Connection
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] text-slate-400 mb-1 block">
                  Endpoint URL
                </label>
                <input
                  type="text"
                  value={device.connection?.endpoint_url ?? ""}
                  placeholder="opc.tcp://192.168.1.100:4840"
                  disabled={isReadOnly}
                  onChange={(e) =>
                    updNested("connection", "endpoint_url", e.target.value)
                  }
                  className={inp}
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                OPC UA Nodes
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs" style={{ minWidth: 550 }}>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Label", "Node ID", "Data Type", ""].map((h) => (
                      <th key={h} className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {nodes.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center py-8 text-slate-400 italic text-xs">
                        No OPC UA nodes configured.
                      </td>
                    </tr>
                  )}
                  {nodes.map((node, i) => (
                    <tr key={i}>
                      <td className={td}>
                        <input
                          value={node.label ?? ""}
                          disabled={isReadOnly}
                          onChange={(e) => updNode(i, "label", e.target.value)}
                          className={inp}
                        />
                      </td>
                      <td className={td}>
                        <input
                          value={node.node_id ?? ""}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            updNode(i, "node_id", e.target.value)
                          }
                          className={inp}
                        />
                      </td>
                      <td className={td}>
                        <select
                          value={node.data_type ?? "STRING"}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            updNode(i, "data_type", e.target.value)
                          }
                          className={inp}>
                          {DATA_TYPES.map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
                      </td>
                      <td className={td}>
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => removeNode(i)}
                          className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              disabled={isReadOnly}
              onClick={addNode}
              className="mt-2 w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-500 hover:border-zinc-400 hover:text-zinc-700 hover:bg-white transition-colors disabled:opacity-50">
              + Add Node
            </button>
          </div>
        </>
      )}

      {/* FILE SHARING */}
      {isFileBased && (
        <>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
              File Sharing
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] text-slate-400 mb-1 block">
                  File Location
                </label>
                <input
                  type="text"
                  value={device.connection?.file_location ?? ""}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    updNested("connection", "file_location", e.target.value)
                  }
                  className={inp}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">
                  Username
                </label>
                <input
                  type="text"
                  value={device.connection?.username ?? ""}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    updNested("connection", "username", e.target.value)
                  }
                  className={inp}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">
                  Password
                </label>
                <input
                  type="password"
                  value={device.connection?.password ?? ""}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    updNested("connection", "password", e.target.value)
                  }
                  className={inp}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["Column Name", "Data Type", ""].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {columns.map((col, i) => (
                  <tr key={i}>
                    <td className={td}>
                      <input
                        value={col.column_name ?? ""}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updColumn(i, "column_name", e.target.value)
                        }
                        className={inp}
                      />
                    </td>
                    <td className={td}>
                      <select
                        value={col.data_type ?? "STRING"}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updColumn(i, "data_type", e.target.value)
                        }
                        className={inp}>
                        {DATA_TYPES.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </td>
                    <td className={td}>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => removeColumn(i)}>
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={isReadOnly}
            onClick={addColumn}
            className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs">
            + Add Column
          </button>
        </>
      )}

      {/* MODBUS TCP */}
      {isModbusTcp && (
        <>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
              Modbus TCP Connection
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">
                  IP Address
                </label>
                <input
                  type="text"
                  value={device.connection?.ip ?? ""}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    updNested("connection", "ip", e.target.value)
                  }
                  className={inp}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">
                  Port
                </label>
                <input
                  type="number"
                  value={device.connection?.port ?? 502}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    updNested("connection", "port", Number(e.target.value))
                  }
                  className={inp}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["Tag Name", "Address", "Data Type", "Length", ""].map(
                    (h) => (
                      <th key={h} className={th}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {registers.map((reg, i) => (
                  <tr key={i}>
                    <td className={td}>
                      <input
                        value={reg.tag_name ?? ""}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updRegister(i, "tag_name", e.target.value)
                        }
                        className={inp}
                      />
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        value={reg.address ?? ""}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updRegister(i, "address", Number(e.target.value))
                        }
                        className={inp}
                      />
                    </td>
                    <td className={td}>
                      <select
                        value={reg.data_type ?? "INT"}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updRegister(i, "data_type", e.target.value)
                        }
                        className={inp}>
                        {DATA_TYPES.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        value={reg.length ?? 1}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updRegister(i, "length", Number(e.target.value))
                        }
                        className={inp}
                      />
                    </td>
                    <td className={td}>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => removeRegister(i)}>
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={isReadOnly}
            onClick={addRegister}
            className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs">
            + Add Register
          </button>
        </>
      )}
    </div>
  );
}