#!/usr/bin/env python3
"""
mentra_receiver.py — receive Mentra Live photo uploads and forward them to BeeTree.

WHAT THIS IS
------------
Mentra Live uploads captured JPEGs *directly from the glasses over Wi-Fi* to a
webhook URL (the phone is only a fallback relay). This is that webhook, sized to
run on a Raspberry Pi Zero W sitting near the hives.

It is a pure HTTP receiver. It does NOT talk Bluetooth and needs no SDK — the
glasses push to it. That matters: the Pi's only BLE radio is already saturated by
the BroodMinder repeater, and this design leaves it alone.

    Mentra Live --(Wi-Fi, multipart POST)--> this receiver --> BeeTree /api/mentra/photo
                                                            --> ontology + state ledger

WHY IT DOESN'T JUST PROXY STRAIGHT THROUGH
------------------------------------------
1. The Pi will almost never have line-of-sight Wi-Fi to the mac that runs BeeTree.
   The forward is a *store-and-forward queue*: if BeeTree is unreachable the
   upload is spooled to disk and retried later, so a hive visit is never lost.
2. The glasses' uploader wants a fast answer. It gets one immediately; the slow
   vision-model call happens out of band.

Python 3.13 note: the `cgi` module was removed in 3.13, so multipart is parsed by
hand below. Do not "simplify" this with cgi.FieldStorage — it does not exist here.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, request

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

STATE_DIR = Path(os.environ.get("MENTRA_STATE_DIR", "/var/lib/mentra"))
UPLOAD_DIR = STATE_DIR / "uploads"      # images awaiting forward
ARCHIVE_DIR = STATE_DIR / "forwarded"   # images already forwarded (prunable)
SPOOL_DIR = STATE_DIR / "spool"         # sidecar JSON, written last as the "commit"

MAX_UPLOAD_BYTES = 32 * 1024 * 1024     # a 12MP JPEG is ~6-8MB; 32MB is slack
FORWARD_TIMEOUT = 300                   # vision call takes 30-60s; be generous
RETRY_BACKOFF = (5, 15, 60, 300, 900)   # seconds between forward attempts

DEFAULT_SOURCE = "mentra-live"

log_lock = threading.Lock()


def log(msg: str) -> None:
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    with log_lock:
        print(f"[{stamp}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Multipart parsing (hand-rolled — see module docstring re: Python 3.13)
# ---------------------------------------------------------------------------

def parse_boundary(content_type: str) -> bytes | None:
    """Pull the boundary token out of a multipart Content-Type header."""
    if "multipart/form-data" not in content_type.lower():
        return None
    m = re.search(r'boundary="?([^";]+)"?', content_type, re.I)
    return m.group(1).encode() if m else None


def parse_multipart(body: bytes, boundary: bytes) -> dict[str, tuple[dict, bytes]]:
    """
    Return {field_name: (headers_dict, raw_value_bytes)} for one multipart body.

    Tolerant by design: an uploader we don't control may add parts, rename the
    file part, or omit the filename. We surface every part and let the caller
    decide, rather than raising on an unexpected shape.
    """
    parts: dict[str, tuple[dict, bytes]] = {}
    delim = b"--" + boundary

    for chunk in body.split(delim):
        if not chunk or chunk in (b"--", b"--\r\n", b"\r\n"):
            continue
        chunk = chunk.lstrip(b"\r\n")
        head, sep, value = chunk.partition(b"\r\n\r\n")
        if not sep:
            continue
        value = value.rstrip(b"\r\n")

        headers: dict[str, str] = {}
        for line in head.split(b"\r\n"):
            if b":" in line:
                k, _, v = line.partition(b":")
                headers[k.decode("latin-1").strip().lower()] = v.decode("latin-1").strip()

        name = ""
        cd = headers.get("content-disposition", "")
        m = re.search(r'name="([^"]*)"', cd)
        if m:
            name = m.group(1)
        if name:
            parts[name] = (headers, value)

    return parts


def sniff_image_ext(data: bytes) -> str | None:
    """Identify an image by magic bytes. Extension and Content-Type both lie."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"GIF8"):
        return "gif"
    return None


def to_data_url(data: bytes, declared_type: str | None) -> str | None:
    """
    Convert raw upload bytes to the data URL BeeTree's capture route expects.

    Returns None when the bytes are not an image. We deliberately do NOT invent a
    MIME type for unknown data: a wrong guess would be handed to the vision model
    as a valid frame.

    The *sniffed* magic bytes are authoritative, not `declared_type`. An uploader
    that labels a JPEG as image/png would otherwise hand the vision model a
    mislabelled frame — and if it disagrees, that is a bug worth surfacing rather
    than silently trusting the header.
    """
    ext = sniff_image_ext(data)
    if not ext:
        return None
    mime = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}[ext]
    if declared_type and declared_type.startswith("image/") and declared_type != mime:
        log(f"upload: declared {declared_type} but bytes are {mime} — trusting the bytes")
    return f"data:{mime};base64," + base64.b64encode(data).decode()


# ---------------------------------------------------------------------------
# The spool — store and forward
# ---------------------------------------------------------------------------

def ensure_dirs() -> None:
    for d in (UPLOAD_DIR, ARCHIVE_DIR, SPOOL_DIR):
        d.mkdir(parents=True, exist_ok=True)


def spool_upload(image: bytes, meta: dict) -> str:
    """
    Persist an upload durably and return its id.

    Write order is image first, sidecar JSON last. The sidecar is the commit
    marker: the forwarder only considers uploads that have one, so a power cut
    mid-write can never produce a queue entry pointing at a truncated image.
    """
    upload_id = meta.get("requestId") or meta.get("request_id") or uuid.uuid4().hex
    # requestId comes off the wire, so it must never become a path. Strip every
    # character that could act as a separator, bound the length, then remove
    # leading/trailing dots so the name can never be a dotfile or a bare "."/"..".
    clean = re.sub(r"[^A-Za-z0-9._-]", "_", str(upload_id))[:120].strip("._")
    if not clean or set(clean) <= {".", "_", "-"}:
        clean = uuid.uuid4().hex
    upload_id = clean

    img_path = UPLOAD_DIR / f"{upload_id}.bin"
    img_path.write_bytes(image)
    os.chmod(img_path, 0o600)

    sidecar = SPOOL_DIR / f"{upload_id}.json"
    tmp = sidecar.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(meta, indent=1))
    tmp.replace(sidecar)  # atomic
    return upload_id


def pending_uploads() -> list[Path]:
    """Sidecars with no matching archive entry, oldest first."""
    out = []
    for sidecar in sorted(SPOOL_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime):
        if not (ARCHIVE_DIR / sidecar.name).exists():
            out.append(sidecar)
    return out


def beeline_configured(cfg: dict) -> bool:
    return bool(cfg.get("beetree_url") and cfg.get("beetree_key"))


def hive_id_of(meta: dict) -> str | None:
    """BeeTree calls it hiveId; Mentra metadata may use hive_id."""
    val = meta.get("hiveId") or meta.get("hive_id")
    return str(val) if val else None


def forward_one(sidecar: Path, cfg: dict) -> bool:
    """
    POST one spooled upload to BeeTree. Returns True once accepted.

    BeeTree's route wants JSON {image, transcript, hiveId, source}. Our own
    `source`/`receivedAt` are kept locally so a receiver change is never mistaken
    for a beekeeper-visible capture attribute.
    """
    try:
        meta = json.loads(sidecar.read_text())
    except (ValueError, OSError) as e:
        log(f"spool: unreadable sidecar {sidecar.name}: {e}")
        return False

    upload_id = sidecar.stem
    img_path = UPLOAD_DIR / f"{upload_id}.bin"
    if not img_path.exists():
        log(f"spool: image missing for {upload_id}, dropping")
        (ARCHIVE_DIR / sidecar.name).write_text(sidecar.read_text())
        return True

    data_url = to_data_url(img_path.read_bytes(), meta.get("contentType"))
    if not data_url:
        log(f"spool: {upload_id} is not an image, dropping")
        (ARCHIVE_DIR / sidecar.name).write_text(sidecar.read_text())
        return True

    payload = {"image": data_url, "source": "mentra-live"}
    # BeeTree's capture route accepts exactly: image, hiveId, transcript, source.
    # There is no `hiveName` field — a spoken hive name reaches the server as free
    # text and is resolved there against the known-hive list. So `metadata.hiveName`
    # has to be folded into `transcript`, or it is silently dropped (which is what
    # happened before this was noticed: the capture landed with hive=None).
    hive_name = meta.get("hiveName")
    transcript = meta.get("transcript")
    hive_id = hive_id_of(meta)
    if hive_name and not hive_id:
        if transcript and hive_name.lower() not in transcript.lower():
            transcript = f"{transcript} (at {hive_name})"
        elif not transcript:
            transcript = f"at {hive_name}"
    if hive_id:
        payload["hiveId"] = hive_id
    if transcript:
        payload["transcript"] = str(transcript)
    for key in ("capturedAt",):
        if meta.get(key):
            payload[key] = meta[key]

    req = request.Request(
        cfg["beetree_url"].rstrip("/") + "/api/mentra/photo",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + cfg["beetree_key"],
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=FORWARD_TIMEOUT) as resp:
            body = json.loads(resp.read())
    except error.HTTPError as e:
        detail = e.read()[:200].decode("utf-8", "replace")
        log(f"forward: {upload_id} -> HTTP {e.code}: {detail}")
        # 4xx other than rate-limiting will never succeed on retry. Archive it so
        # one poisoned upload cannot block the queue forever.
        if 400 <= e.code < 500 and e.code != 429:
            (ARCHIVE_DIR / sidecar.name).write_text(sidecar.read_text())
            log(f"forward: {upload_id} rejected permanently, archived")
            return True
        return False
    except (error.URLError, TimeoutError, OSError) as e:
        log(f"forward: {upload_id} -> network: {e}")
        return False

    log(f"forward: {upload_id} OK  speech={body.get('speech', '')!r}")
    (ARCHIVE_DIR / sidecar.name).write_text(sidecar.read_text())
    return True


def worker(cfg: dict, stop: threading.Event) -> None:
    """Drain the spool forever, with backoff, so a hive visit is never lost."""
    attempt = 0
    while not stop.is_set():
        try:
            queued = pending_uploads()
        except OSError as e:
            log(f"worker: cannot read spool: {e}")
            queued = []

        if not queued:
            attempt = 0
            stop.wait(10)
            continue

        log(f"worker: {len(queued)} upload(s) queued")
        for sidecar in queued:
            if stop.is_set():
                break
            if forward_one(sidecar, cfg):
                attempt = 0
            else:
                delay = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                attempt += 1
                log(f"worker: backing off {delay}s")
                stop.wait(delay)
                break
        stop.wait(2)


def prune_archive(keep_days: int = 30) -> None:
    """Keep the Pi's microSD from filling. The canonical copy lives on the mac."""
    cutoff = datetime.now(timezone.utc).timestamp() - keep_days * 86400
    removed = 0
    for sidecar in ARCHIVE_DIR.glob("*.json"):
        if sidecar.stat().st_mtime < cutoff:
            (UPLOAD_DIR / f"{sidecar.stem}.bin").unlink(missing_ok=True)
            sidecar.unlink(missing_ok=True)
            removed += 1
    if removed:
        log(f"prune: removed {removed} archived upload(s)")


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "MentraReceiver/1.0"
    cfg: dict = {}

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        # BaseHTTPRequestHandler's default writes to stderr unformatted; route it
        # through our logger so journalctl output is consistent. The parameter is
        # named `format` to match the base class signature.
        log(f"{self.address_string()} {format % args}")

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/api/health"):
            cfg = self.server.cfg  # type: ignore[attr-defined]
            self._json(200, {
                "status": "ok",
                "service": "mentra-receiver",
                "queued": len(pending_uploads()),
                "beetree": cfg.get("beetree_url") or None,
                "beetreeReachable": cfg.get("_reachable", False),
                "stateDir": str(STATE_DIR),
            })
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path not in ("/upload", "/mentra/photo", "/api/mentra/photo"):
            self._json(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._json(400, {"error": "empty body"})
            return
        if length > MAX_UPLOAD_BYTES:
            self._json(413, {"error": f"too large ({length} bytes)"})
            return

        body = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "")

        image: bytes | None = None
        meta: dict = {}

        if "multipart/form-data" in ctype.lower():
            boundary = parse_boundary(ctype)
            if not boundary:
                self._json(400, {"error": "multipart boundary missing"})
                return
            parts = parse_multipart(body, boundary)
            # The file part is `photo` (or `video`/`file` per the starter kit).
            # Pick by filename presence, then fall back to known names.
            for name in ("photo", "file", "image", "video", "media"):
                if name in parts:
                    hdrs, val = parts[name]
                    if val:
                        image = val
                        meta["contentType"] = hdrs.get("content-type")
                        break
            if image is None:
                for name, (hdrs, val) in parts.items():
                    if val and sniff_image_ext(val):
                        image = val
                        meta["contentType"] = hdrs.get("content-type")
                        break

            for name, (_hdrs, val) in parts.items():
                if name in ("photo", "file", "image", "video", "media"):
                    continue
                # requestId / metadata / type / success are the documented extras.
                if name == "metadata":
                    try:
                        meta.update(json.loads(val.decode("utf-8", "replace")))
                    except ValueError:
                        pass
                elif name in ("requestId", "request_id"):
                    meta["requestId"] = val.decode("utf-8", "replace").strip()
                elif val and len(val) < 4096:
                    meta[name] = val.decode("utf-8", "replace").strip()
        elif "application/json" in ctype.lower():
            try:
                obj = json.loads(body)
            except ValueError:
                self._json(400, {"error": "invalid JSON"})
                return
            raw = obj.get("image") or obj.get("photo") or ""
            if isinstance(raw, str) and raw.startswith("data:"):
                _, _, b64 = raw.partition(",")
                try:
                    image = base64.b64decode(b64, validate=False)
                except (ValueError, TypeError):
                    image = None
            for k, v in obj.items():
                if k not in ("image", "photo"):
                    meta[k] = v
        else:
            self._json(415, {"error": f"unsupported Content-Type: {ctype}"})
            return

        if not image:
            self._json(400, {"error": "no image part found"})
            return

        ext = sniff_image_ext(image)
        if not ext:
            self._json(400, {"error": "uploaded bytes are not a recognised image"})
            return

        # Authorization: the glasses send a bearer token when the app configures
        # one. If we expect a token, enforce it — an open upload endpoint on a
        # tailnet is still an open upload endpoint.
        expected = self.server.cfg.get("upload_token")  # type: ignore[attr-defined]
        if expected:
            got = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
            if got != expected:
                log(f"upload: rejected — bad or missing token from {self.address_string()}")
                self._json(401, {"error": "unauthorized"})
                return

        meta.setdefault("contentType", {"jpg": "image/jpeg", "png": "image/png",
                                        "webp": "image/webp", "gif": "image/gif"}[ext])
        meta["receivedAt"] = datetime.now(timezone.utc).isoformat()
        meta["source"] = DEFAULT_SOURCE
        meta["bytes"] = len(image)

        try:
            upload_id = spool_upload(image, meta)
        except OSError as e:
            log(f"upload: cannot spool: {e}")
            self._json(500, {"error": "cannot persist upload"})
            return

        log(f"upload: accepted {upload_id} ({len(image)} bytes, {ext}) queued={len(pending_uploads())}")
        # Answer immediately: the glasses' uploader should not wait on the
        # vision model. The spool guarantees delivery.
        self._json(202, {"ok": True, "requestId": upload_id, "queued": len(pending_uploads())})


def probe_beetree(cfg: dict) -> bool:
    """One-shot reachability check, surfaced on /health for field debugging."""
    if not beeline_configured(cfg):
        return False
    try:
        req = request.Request(
            cfg["beetree_url"].rstrip("/") + "/api/health",
            headers={"Authorization": "Bearer " + cfg["beetree_key"]},
        )
        with request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except (error.URLError, error.HTTPError, TimeoutError, OSError):
        return False


def main() -> int:
    global STATE_DIR, UPLOAD_DIR, ARCHIVE_DIR, SPOOL_DIR

    ap = argparse.ArgumentParser(description="Mentra Live photo receiver -> BeeTree")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--beetree-url", default=os.environ.get("BEETREE_URL", ""))
    ap.add_argument("--beetree-key", default=os.environ.get("BEETREE_API_KEY", ""))
    ap.add_argument("--upload-token", default=os.environ.get("MENTRA_UPLOAD_TOKEN", ""))
    # Default to the module-level path, but read it here so the `global`
    # declaration above stays the first statement in this scope.
    ap.add_argument("--state-dir", default=str(STATE_DIR))
    ap.add_argument("--prune-days", type=int, default=30)
    ap.add_argument("--once", action="store_true",
                    help="drain the spool once and exit (for testing)")
    args = ap.parse_args()

    STATE_DIR = Path(args.state_dir)
    UPLOAD_DIR = STATE_DIR / "uploads"
    ARCHIVE_DIR = STATE_DIR / "forwarded"
    SPOOL_DIR = STATE_DIR / "spool"
    ensure_dirs()

    cfg = {
        "beetree_url": args.beetree_url,
        "beetree_key": args.beetree_key,
        "upload_token": args.upload_token,
    }
    cfg["_reachable"] = probe_beetree(cfg)

    if args.once:
        ensure_dirs()
        prune_archive(args.prune_days)
        queued = pending_uploads()
        log(f"once: {len(queued)} upload(s) queued, {len(list(ARCHIVE_DIR.glob('*.json')))} archived")
        ok = sum(1 for s in queued if forward_one(s, cfg))
        log(f"once: forwarded {ok}/{len(queued)}")
        return 0 if ok == len(queued) else 1

    if not beeline_configured(cfg):
        log("WARNING: no --beetree-url/--beetree-key — uploads will queue but never forward")
    else:
        log(f"forwarding to {cfg['beetree_url']}  reachable={cfg['_reachable']}")
    if not args.upload_token:
        log("WARNING: --upload-token not set — the endpoint accepts unauthenticated uploads")

    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.cfg = cfg  # type: ignore[attr-defined]

    stop = threading.Event()
    t = threading.Thread(target=worker, args=(cfg, stop), daemon=True)
    t.start()

    log(f"listening on http://{args.host}:{args.port}/upload  state={STATE_DIR}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        stop.set()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
