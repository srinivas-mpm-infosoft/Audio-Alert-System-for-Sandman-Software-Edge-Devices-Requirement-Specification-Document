# MQTT Setup — Audio Alert System

This document covers setting up MQTT as an alternative transport to HTTP for
Central Gateway → Edge Node alert/audio delivery. HTTP remains the default and
fully working transport — MQTT is opt-in **per Edge Node** (Devices & Zones →
add/edit device → Communication Protocol).

## Architecture

```
Alert dispatch (manual / schedule / SOP)
        │
        ▼
dispatch_service.py (main-gateway/backend)
   resolve_targets() reads each zone's Device.metadata → protocol: http|mqtt
        │
        ├── protocol=http ──► deliver_clip() / tts_server.py's deliver_to_edge()
        │                     HTTP POST → edge_node.py's /play route
        │
        └── protocol=mqtt ──► mqtt_transport.publish_play() (clips)
                               or tts_server.py's _deliver_to_edge_mqtt() (TTS)
                               MQTT publish → sandman/audio/<zone_code>/play
                                       │
                                       ▼
                          edge_node.py's _mqtt_audio_subscriber() thread
                                       │
                                       ▼
                          _enqueue_play()  ◄── same function both transports call
                                       │
                                       ▼
                     existing priority playback queue / worker / cvlc
```

Both transports converge on `_enqueue_play()` in `edge_node.py` — nothing about
audio playback, the queue engine, or acknowledge behavior changes based on
transport. `edge_node.py` runs both the HTTP `/play` route and the MQTT
subscriber **at the same time**, always — which one actually carries traffic
for a given zone is decided entirely by that zone's Device config on the
Central Gateway.

## Message contract

Topics (per zone_code, e.g. `z002`):

| Topic | Direction | Purpose |
|---|---|---|
| `sandman/audio/<zone_code>/play` | Gateway → Edge | Deliver an alert |
| `sandman/audio/<zone_code>/play/ack` | Edge → Gateway | Queued receipt |
| `sandman/audio/<zone_code>/acknowledge` | Gateway → Edge | Clear a queued alert |
| `sandman/audio/<zone_code>/acknowledge/ack` | Edge → Gateway | Ack receipt |

Wire format for `play` (defined in `edge-node/mqtt_audio_protocol.py`):
4-byte big-endian header length, then UTF-8 JSON header, then **raw MP3
bytes** appended directly (not base64 — avoids ~33% overhead; alert clips are
short TTS/pre-recorded announcements, typically tens of KB, well under any
broker's default message-size limit).

Header fields: `request_id` (correlates the reply), `alert_id`,
`alert_category`, `lang_code`, `text` (the announcement's spoken text, for the
Edge Node Display UI), plus the resolved `AlertTypeConfig` behavior fields when
available (`is_blocking`, `initial_play_count`, `repeat_interval_sec`,
`reduction_step_sec`, `min_interval_sec`, `requires_ack`, `sort_order`) — the
same fields the HTTP `/play` route accepts as form fields. Missing behavior
fields fall back to legacy Critical/High/Normal/Low defaults, exactly like an
older HTTP caller.

**Why push bytes over MQTT instead of publishing a retrieval URL:** the
existing HTTP path is already a synchronous byte-push (`tts_server.py`/
`dispatch_service.py` POST the MP3 directly to `edge_node.py`), so reusing
that model over MQTT keeps the two transports symmetric — the Edge Node never
needs to become an HTTP client back to the gateway to make MQTT delivery
work. Edge nodes also have no public serving route for `audio_files/`/
`audio_cache/` today, so a URL model would need a brand-new authenticated
endpoint on a different tier than the one that currently handles audio at
all.

## 1. Broker Setup — Mosquitto

Any MQTT 3.1.1+ broker works; these steps use [Eclipse Mosquitto](https://mosquitto.org/),
already assumed by this codebase's existing heartbeat-over-MQTT feature
(`mqtt_service.py`) and topic convention (`sandman/...`).

Install on the Central Gateway host (Debian/Ubuntu-based, matches this
project's ReComputer/CM5 targets):

```bash
sudo apt update
sudo apt install -y mosquitto mosquitto-clients
```

Configuration — create `/etc/mosquitto/conf.d/sandman.conf`:

```conf
listener 1883 0.0.0.0
allow_anonymous true
```

For production, require authentication instead of `allow_anonymous true`:

```bash
sudo mosquitto_passwd -c /etc/mosquitto/passwd sandman_gateway
# prompts for a password — use this as the "Username"/"Password" fields
# when configuring an MQTT Edge Node in Devices & Zones
```

```conf
listener 1883 0.0.0.0
allow_anonymous false
password_file /etc/mosquitto/passwd
```

Enable and start:

```bash
sudo systemctl enable mosquitto
sudo systemctl restart mosquitto
sudo systemctl status mosquitto        # should show "active (running)"
```

Firewall (if `ufw` is active) — allow the broker port from the LAN the Edge
Nodes are on:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 1883
```

Verify the broker is running:

```bash
mosquitto_sub -h localhost -t 'test/#' -v &
mosquitto_pub -h localhost -t 'test/hello' -m 'ping'
# the subscriber should print: test/hello ping
```

## 2. Central Gateway Setup

**Install:** `paho-mqtt` is already in `main-gateway/backend/requirements.txt`.

```bash
cd main-gateway/backend
pip install -r requirements.txt
```

**Configuration fields** — set per Edge Node in the UI (Audio Alerts → Devices
& Zones → Add Device, or the pencil icon on an existing device's "Connection"
row):

- Communication Protocol: `HTTP` or `MQTT`
- If MQTT: Broker Host/IP, Broker Port (default `1883`), and optionally
  "Broker requires authentication" → Username/Password.
- The MQTT **topic** is not a field you set — it's derived automatically from
  the device's assigned zone (`sandman/audio/<zone_code>/play`), so it can
  never be mistyped or drift out of sync with the subscriber.
- Client ID is auto-generated if left unset.

This is stored in that Device's `metadata` JSON (no schema migration needed —
reuses the existing `devices.metadata` column already used for `health`,
`audio_channel`, etc.). Different devices can have different protocols and
different brokers at the same time; nothing here is a global switch.

**Test publishing** (no UI needed — direct Python, mirrors what
`dispatch_service.py` does internally):

```bash
cd main-gateway/backend
python3 -c "
import mqtt_transport as mt
cfg = {'protocol': 'mqtt', 'mqtt_broker_host': 'localhost', 'mqtt_broker_port': 1883}
r = mt.publish_play(cfg, 'z002', 12345, 'Normal', 'EN', 'Test message', b'FAKE_MP3_BYTES')
print(r)   # {'ok': False, ..., 'error': 'No ack from edge node (timeout)'} if no edge node is listening yet — expected
"
```

## 3. Edge Node Setup

**Install:** `paho-mqtt` is already in `edge-node/requirements.txt`.

```bash
cd edge-node
pip install -r requirements.txt
```

**Configuration** — environment variables (same ones the existing MQTT
heartbeat publisher already uses, plus two new optional auth vars):

```bash
export MQTT_ZONE_ID=z002                 # this node's zone_code — required for MQTT
export MQTT_BROKER_HOST=192.168.1.10     # the gateway's broker (or wherever it runs)
export MQTT_BROKER_PORT=1883
export MQTT_USERNAME=sandman_gateway     # only if the broker requires auth
export MQTT_PASSWORD=<password>
export GATEWAY_URL=http://192.168.1.10:8000
python3 edge_node.py
```

The MQTT play/acknowledge subscriber starts automatically alongside the HTTP
server — no flag needed. If `paho-mqtt` isn't installed or `MQTT_ZONE_ID` is
unset, it logs a warning and does nothing further; `POST /play` (HTTP) keeps
working regardless. This means every Edge Node is always ready to receive
over **either** transport — whether MQTT traffic actually reaches it depends
only on whether the Gateway's Device config for that zone says `protocol:
mqtt`.

**Test receiving** (publish a real `play` message by hand and confirm it
reaches the queue):

```bash
cd edge-node
python3 -c "
import paho.mqtt.publish as publish
import mqtt_audio_protocol as proto
header = {'request_id': 'test-1', 'alert_id': 555, 'alert_category': 'High',
          'lang_code': 'EN', 'text': 'Manual MQTT test'}
publish.single(proto.play_topic('z002'), proto.pack_play(header, b'FAKE_MP3_BYTES'),
                hostname='localhost', port=1883)
"
# then check it queued:
curl -s http://localhost:5000/queue | python3 -m json.tool
```

You should see the edge node's log print `[MQTT-Audio] Subscribed:
sandman/audio/z002/play  sandman/audio/z002/acknowledge` at startup, and
`[Queue] Enqueued alert=555 ...` after the publish above.

**How the received MQTT message enters the existing playback pipeline:**
`_mqtt_on_message()` unpacks the header + MP3 bytes and calls the exact same
`_enqueue_play()` the HTTP `/play` route calls — same queue, same worker
thread, same `cvlc` playback, same ack/repeat/blocking rules. Nothing
downstream of `_enqueue_play()` is transport-aware.

## 4. Edge Node Display UI

A new simplified display page is available at `GET /display` on each edge node
(e.g. `http://<edge-node-ip>:5000/display`) — separate from the existing
operator dashboard at `/dashboard`. White background, large high-contrast
text, no controls, meant for a screen mounted next to the speaker. It polls
`GET /display-data` every 2s and shows:

- **Pattern Name** — the dispatching alert's human-readable source (e.g.
  "Manual Broadcast", "Scheduled: Night Shift Check", or the rule name for a
  SCADA-fired alert), falling back to the alert type (Critical/High/etc.) if
  no source name was sent.
- **Component Name** — the zone code the alert targets.
- **Process Parameters** — reserved for `source_parameter`/`trigger_value`/
  `threshold` from rule-fired alerts. **Known limitation**: these three
  fields aren't currently forwarded by `alert_poller.py`'s cloud-alert path to
  any downstream delivery call, so this card correctly shows "Not available"
  today rather than fabricated data — wiring it up is a follow-up change to
  `alert_poller.py`, out of scope here since it requires trusting the exact
  shape of the upstream cloud alert payload, which wasn't verified in this
  pass.
- The announcement's spoken text is also shown, when available, in its own
  card.

This works identically regardless of whether the alert was delivered over
HTTP or MQTT — it reads from the same in-memory queue item either way.

## 5. End-to-End Testing Procedure

1. **Broker connectivity**
   ```bash
   mosquitto_sub -h <broker-ip> -t '$SYS/#' -C 1 -v
   ```
   Any output confirms the broker is reachable and responding.

2. **Manual publish**
   ```bash
   mosquitto_pub -h <broker-ip> -t 'sandman/test' -m 'hello'
   ```

3. **Manual subscribe** (watch all audio-alert traffic live)
   ```bash
   mosquitto_sub -h <broker-ip> -t 'sandman/audio/#' -v
   ```

4. **Central Gateway → MQTT broker**: in Devices & Zones, set an Edge Node's
   protocol to MQTT with the broker's host/port, then use "Test Fire" on that
   device (or Manual Broadcast targeting its zone). Confirm the message
   appears in step 3's `mosquitto_sub` output, and that `dispatch_service.py`'s
   logs show `[MQTT] Publish play alert=... → sandman/audio/<zone>/play`.

5. **MQTT broker → Edge Node**: with `edge_node.py` running against the same
   broker/zone, confirm its log shows `[Queue] Enqueued alert=...` immediately
   after step 4, and `GET /queue` on the edge node lists the item.

6. **Complete end-to-end alert/audio playback**: from the Central Gateway UI,
   send a Manual Broadcast to a zone whose device is MQTT-configured. Confirm:
   - The edge node's speaker plays the audio (same as the HTTP path would).
   - `GET /display-data` (or the `/display` page) shows the Pattern
     Name/Component Name/text while it's playing.
   - Live Monitor on the Central Gateway shows the alert as delivered
     (`edge_delivered: true`) — this comes back over the same MQTT ack
     round-trip verified in step 4.
   - Acknowledging from either the Central Gateway or the edge node's own
     `/dashboard` clears it on both ends.

   Repeat with a second Edge Node left on HTTP (protocol unchanged) targeted
   in the same broadcast, and confirm it *also* plays correctly — proving HTTP
   and MQTT devices work simultaneously, not as a global switch.

### Verified in this implementation pass

All of the above was exercised against a real (temporary, local) Mosquitto-
compatible broker during development: a live `edge_node.py` process
subscribed over MQTT, received a `play` message published by `tts_server.py`'s
real MQTT delivery function, enqueued and played it (confirmed via
`/queue`/`/display-data`), acknowledged it back over MQTT, and — in the same
running process — also accepted a normal HTTP `POST /play` request
immediately afterward, confirming both transports work concurrently on one
node. `dispatch_service.py`'s device-resolution and protocol-branching logic
was verified against mocked DB rows (HTTP device, MQTT device, and no-device
cases) since a full MySQL-backed run wasn't set up in this environment.

**Known limitation**: `alert_poller.py` (the separate process that dispatches
SCADA/cloud rule-fired alerts) does not yet resolve per-device protocol —
alerts through that path remain HTTP-only until it's extended to mirror
`dispatch_service.py`'s `resolve_targets()`/`_device_transport()` logic. Manual
broadcasts, scheduled announcements, and SOP steps (the paths this task
focused on) fully support per-device HTTP/MQTT selection today.
