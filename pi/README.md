# Mentra Live photo receiver (Raspberry Pi)

Receives photo uploads from Mentra Live glasses and forwards them to BeeTree for
analysis, ontology inference, and state recording.

```
Mentra Live glasses
   │  Wi-Fi, multipart POST (JPEG)
   ▼
mentra_receiver.py  ──spool to disk──►  background forwarder
   │  immediate 202                          │
   ▼                                         ▼ HTTPS + Bearer
phone app gets its answer            BeeTree /api/mentra/photo
                                              │
                                              ├─ vision analysis
                                              ├─ ontology inference + differential checks
                                              ├─ state recorded to the colony (if ≥0.6)
                                              └─ JPEG stored at /media/<id>.jpg
```

## Why the Pi only receives

The glasses upload the JPEG **directly over Wi-Fi to a webhook URL**; the phone is
only a fallback relay. So the Pi never needs to talk Bluetooth, and this design
deliberately keeps it that way — the Pi Zero W's single BLE radio is already fully
occupied by the BroodMinder repeater.

**Issuing** `requestPhoto({webhookUrl})` is a separate job that requires the Mentra
Bluetooth SDK, which ships for Android, iOS, and React Native only. There is no
Linux or Python binding, so the Pi cannot trigger a capture. The phone app remains
the trigger; this is the destination.

## Install

```bash
sudo bash pi/install_receiver.sh \
  --beetree-url https://beetree-host.tailnet-id.ts.net:8443 \
  --beetree-key <BEETREE_API_KEY> \
  --upload-token <a token you invent>
```

Credentials land in `/etc/mentra-receiver.env` (0600, root-owned) rather than on
the `ExecStart` line, so the BeeTree token never appears in `ps` or `systemctl cat`.

Then:

```bash
sudo systemctl enable --now mentra-receiver
curl -s http://localhost:8790/health | python3 -m json.tool
```

## Wiring up the glasses

The webhook URL is `http://<pi-lan-ip>:8790/upload`. Configure it with:

```ts
await BluetoothSdk.requestPhoto({
  size: 'high',
  webhookUrl: 'http://192.168.1.49:8790/upload',
  authToken: '<the upload token>',
  compress: 'none',   // keep resolution — see the resolution note below
  exposureTimeNs: null,
  iso: null,
});
```

`compress: 'none'` matters. The whole point is resolving eggs and larvae, and the
`none`/`medium`/`heavy` tiers trade exactly that detail away.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/upload` | Webhook target. Accepts `multipart/form-data` with a `photo` (or `video`/`file`) part, or JSON `{image: "data:image/jpeg;base64,..."}`. Answers `202` immediately. |
| GET | `/health` | Queue depth, BeeTree URL, and reachability. Use this in the field. |

Also accepts POSTs on `/mentra/photo` and `/api/mentra/photo`, so the URL can be
made to look like the BeeTree route it forwards to.

## Field notes

- **`/health` is the diagnostic.** `queued` climbing while `beetreeReachable` is
  false means the network, not the receiver. `queued` pinned and reachable means
  look at the journal.
- **The queue is the safety net.** If the Pi cannot reach BeeTree, uploads spool
  to disk and forward on the next attempt. A hive visit is not lost to a dead
  network.
- **Archived uploads are pruned after 30 days** (`--prune-days`). Unforwarded
  uploads are *never* pruned — they are the only copy.
- **Port 8787 is taken by Hermes on the Mac.** On a Pi it is probably free, but
  the installer warns if not. Default here is 8790.
- **Python 3.13 removed `cgi`**, so multipart is parsed by hand. Do not "simplify"
  it with `cgi.FieldStorage` — it does not exist.

## Tests

```bash
python3 pi/test_mentra_receiver.py
```

32 tests covering multipart parsing (including binary payloads containing
`\r\n`), magic-byte sniffing, spool commit ordering, path-traversal resistance on
`requestId`, pruning safety, and every forward/retry branch.
