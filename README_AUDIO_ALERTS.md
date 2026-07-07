# Audio Alerts Module — SandMan Gateway UI

Project: MPM Infosoft / NP / IOT / V2026 / 001  
Module: Audio Alert System for SandMan Software & Edge Devices

---

## Project layout

```
main-gateway/
├── backend/     — flask_backend.py + dispatch/heartbeat/scheduler/sop/mqtt services (port 8000)
└── frontend/    — the Vite/React dashboard (this module lives under src/pages/audio_alerts/)
edge-node/       — edge_node.py (port 5000, one per speaker), alert_poller.py (port 7000),
                   tts_server.py (port 6000) — deployed on-device, not on the gateway
```

Run the Main Gateway backend:
```bash
cd main-gateway/backend
python3 flask_backend.py        # http://localhost:8000
```

Run the Main Gateway frontend:
```bash
cd main-gateway/frontend
npm install                     # first time only
npm run dev                     # http://localhost:5173 (or `npm run build` for production)
```

Run an Edge Node (on each speaker device):
```bash
cd edge-node
MQTT_ZONE_ID=<this-node's-zone-code> GATEWAY_URL=http://<gateway-host>:8000 python3 edge_node.py
# Dashboard: http://<edge-node-host>:5000/dashboard
```
`MQTT_ZONE_ID` is optional for basic playback but required for the local dashboard's
SOP status/acknowledge panel (it's how the node tells the gateway which zone it is).

---

## Running with mock data (no backend required)

```bash
cd main-gateway/frontend
npm run dev
```

`.env.development` ships with `VITE_USE_MOCKS=true`. All API calls are
intercepted by the files under `src/pages/audio_alerts/api/` and return
realistic data from `src/pages/audio_alerts/mocks/`.  Mock state is
in-memory and resets on page refresh. Live Monitor simulates new alerts
arriving every 8–20 seconds.

---

## Switching to the real backend

1. Edit `.env.development` and set `VITE_USE_MOCKS=false`.
2. Ensure the backend is running and `src/config.js` has the correct `targetUrl`.
3. Restart the Vite dev server.

All API calls will then use `credentials: 'include'` (session cookies) to
the real Flask/Node-RED backend at `${targetUrl}/audio-alerts/...`.

---

## API contract summary

All endpoints are prefixed with the `targetUrl` from `src/config.js`.  
All responses follow the shape: `{ ok: boolean, data?: any, error?: string }`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/audio-alerts/config` | Engine status, speaker/gateway counts |
| GET | `/audio-alerts/active` | Active alert queue (filterable) |
| WS | `/audio-alerts/stream` | Push live alert events (fallback: poll) |
| POST | `/audio-alerts/ack` | Acknowledge alert `{ alert_id, note }` |
| POST | `/audio-alerts/broadcast` | Manual broadcast `{ zone_ids, message, language, audio_type, clip_id? }` |
| GET | `/audio-alerts/rules` | List rules (filterable) |
| POST | `/audio-alerts/rules` | Create rule |
| PUT | `/audio-alerts/rules/:id` | Update rule |
| DELETE | `/audio-alerts/rules/:id` | Delete rule |
| POST | `/audio-alerts/rules/:id/enable` | Enable rule |
| POST | `/audio-alerts/rules/:id/disable` | Disable rule |
| POST | `/audio-alerts/rules/:id/test` | Put rule into test mode `{ duration_minutes }` |
| GET | `/audio-alerts/audio/clips` | List audio clips |
| POST | `/audio-alerts/audio/clips` | Upload clip (multipart) |
| DELETE | `/audio-alerts/audio/clips/:id` | Delete clip |
| GET | `/audio-alerts/audio/templates` | List TTS templates |
| POST | `/audio-alerts/audio/templates` | Create template |
| POST | `/audio-alerts/audio/preview` | Preview clip or template `{ clip_id? \| template_id?, zone, language }` |
| GET | `/audio-alerts/devices` | List devices |
| POST | `/audio-alerts/devices` | Add device |
| PUT | `/audio-alerts/devices/:id` | Update device config |
| DELETE | `/audio-alerts/devices/:id` | Remove device |
| POST | `/audio-alerts/devices/:id/test-fire` | Send test beep |
| POST | `/audio-alerts/devices/:id/restart` | Restart device |
| GET | `/audio-alerts/zones` | List zones |
| PUT | `/audio-alerts/zones/:id` | Update zone config |
| GET | `/audio-alerts/analytics` | Analytics data `?from=&to=&plant=&line=&zone=` |
| GET | `/audio-alerts/logs/alerts` | Alert log (paginated) |
| GET | `/audio-alerts/logs/audit` | Audit log (paginated, immutable) |
| GET | `/audio-alerts/users` | User list |
| POST | `/audio-alerts/users` | Create user |
| PUT | `/audio-alerts/users/:id` | Update user |
| DELETE | `/audio-alerts/users/:id` | Delete user |
| GET | `/audio-alerts/security` | Security settings |
| PUT | `/audio-alerts/security` | Update security settings |

Edge-node-facing endpoints below are called server-to-server by `edge-node/edge_node.py`'s
own `/dashboard/*` proxy routes (never directly by a browser), so — like `/play` and
`/acknowledge` on the edge node itself — they intentionally skip session login:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/audio-alerts/edge/alert-info?alert_id=` | Resolve a bare alert_id (from an edge node's `/health currently_playing`) into `{type, name, category, zone_code, started_at}` |
| GET | `/audio-alerts/edge/sop-status?zone=` | Active SOP execution (if any) targeting this zone |
| POST | `/audio-alerts/edge/sop-ack` | `{ execution_id, zone_code }` — acknowledge a SOP step from the edge node's own dashboard |

### Alert event payload (WebSocket / polling)

```json
{
  "alert_id": "uuid",
  "plant": "Plant-1",
  "line": "Line-2",
  "zone": "Moulding-A",
  "zone_id": "z002",
  "priority": "CRITICAL",
  "alert_code": "CMP_LOW",
  "message": "Compactability critically low",
  "language": "EN",
  "repeat": true,
  "trigger_value": 33.2,
  "threshold": 36,
  "source_parameter": "compactability",
  "timestamp": "2026-05-18T10:30:00Z",
  "ack_required": true,
  "escalation_step": 0,
  "status": "Active",
  "repeat_count": 1,
  "playback_status": "queued",
  "device_id": "spk-001",
  "ack_time": null,
  "ack_user": null,
  "ack_source": null
}
```

---

## RBAC / role mapping

The existing 3-role system maps to the 7-role RBAC as follows:

| Gateway UI role | Audio Alerts RBAC role |
|-----------------|------------------------|
| `superadmin` | Administrator (all permissions) |
| `admin` | Plant Manager (no user management) |
| `user` | Operator (live monitor, analytics, logs read-only) |

Fine-grained roles (Process Engineer, Shift Supervisor, Maintenance Technician, Auditor) can be assigned in the Access Control tab by a superadmin.

---

## File structure

```
main-gateway/frontend/src/pages/audio_alerts/
├── index.jsx            — wrapper (status strip + sub-tab router)
├── LiveMonitor.jsx      — Tab 1: per-edge-node live state (online/offline, now playing,
│                          alert type, playback status) + active alert queue
├── RuleBuilder.jsx      — Tab 2: rule list with CRUD
├── RuleForm.jsx         — Tab 2: full rule form
├── AudioConfig.jsx      — Tab 3: voice library, TTS, zones, volumes
├── DevicesZones.jsx     — Tab 4: plant tree, device table, detail panel
├── Analytics.jsx        — Tab 5: charts, shift data, efficacy
├── LogsAudit.jsx        — Tab 6: alert logs + audit log
├── AccessControl.jsx    — Tab 7: user CRUD, permissions matrix, security
├── components/          — shared UI components
├── hooks/               — useAlerts, useRules, useDevices, useCan, etc.
├── api/                 — fetch wrappers (swap mock ↔ real via VITE_USE_MOCKS)
├── mocks/               — realistic foundry mock data
└── utils/               — constants, priorityConfig, formatters
```
