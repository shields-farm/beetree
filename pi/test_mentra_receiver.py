#!/usr/bin/env python3
"""
Tests for mentra_receiver.py — run standalone (no pytest needed):

    python3 pi/test_mentra_receiver.py

Covers the parts that are easy to get wrong and expensive to debug on a Pi in a
field: hand-rolled multipart parsing (Python 3.13 has no `cgi` module), magic-byte
sniffing, the spool's commit ordering, and the store-and-forward retry decisions.
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mentra_receiver as mr  # noqa: E402


JPEG = b"\xff\xd8\xff\xe0" + b"JFIF-ish payload" + b"\xff\xd9"
PNG = b"\x89PNG\r\n\x1a\n" + b"png payload"


def multipart(fields: dict[str, bytes | str], files: dict[str, tuple[str, bytes]] | None = None,
              boundary: str = "----MentraTestBoundary"):
    """
    Build a multipart/form-data body shaped like the one the Mentra starter kit's
    photo-webhook-server documents: a `photo` file part plus `requestId`/`metadata`.
    """
    out = io.BytesIO()
    for name, value in fields.items():
        out.write(f"--{boundary}\r\n".encode())
        out.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        out.write(value if isinstance(value, bytes) else value.encode())
        out.write(b"\r\n")
    for name, (filename, data) in (files or {}).items():
        out.write(f"--{boundary}\r\n".encode())
        out.write(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
        out.write(b"Content-Type: image/jpeg\r\n\r\n")
        out.write(data)
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


def parts_of(body: bytes, ctype: str) -> dict[str, tuple[dict, bytes]]:
    """parse_multipart with a boundary assertion, so type narrowing holds."""
    boundary = mr.parse_boundary(ctype)
    assert boundary is not None, f"no boundary in {ctype!r}"
    return mr.parse_multipart(body, boundary)


class TestMultipart(unittest.TestCase):
    def test_extracts_the_photo_and_scalar_fields(self):
        body, ctype = multipart(
            {"requestId": "abc-123", "type": "photo"},
            {"photo": ("IMG.jpg", JPEG)},
        )
        boundary = mr.parse_boundary(ctype)
        self.assertIsNotNone(boundary)
        parts = parts_of(body, ctype)

        self.assertIn("photo", parts)
        self.assertEqual(parts["photo"][1], JPEG)
        self.assertEqual(parts["requestId"][1], b"abc-123")
        self.assertEqual(parts["type"][1], b"photo")

    def test_picks_up_json_metadata(self):
        body, ctype = multipart(
            {"metadata": json.dumps({"hiveName": "Hive Bravo"})},
            {"photo": ("IMG.jpg", JPEG)},
        )
        parts = parts_of(body, ctype)
        self.assertEqual(json.loads(parts["metadata"][1])["hiveName"], "Hive Bravo")

    def test_binary_payload_is_not_mangled(self):
        # A real JPEG contains \r\n sequences. Splitting on bare newlines rather
        # than the boundary delimiter would corrupt it.
        tricky = b"\xff\xd8\xff\xe0\r\n\r\n--not-a-boundary\r\n\r\n" + b"x" * 512 + b"\xff\xd9"
        body, ctype = multipart({}, {"photo": ("IMG.jpg", tricky)})
        parts = parts_of(body, ctype)
        self.assertEqual(parts["photo"][1], tricky)

    def test_boundary_parsed_from_quoted_and_unquoted_headers(self):
        self.assertEqual(mr.parse_boundary("multipart/form-data; boundary=xyz"), b"xyz")
        self.assertEqual(mr.parse_boundary('multipart/form-data; boundary="xyz"'), b"xyz")

    def test_non_multipart_returns_none(self):
        self.assertIsNone(mr.parse_boundary("application/json"))

    def test_missing_boundary_is_tolerated(self):
        body = b"--nope\r\n\r\nnothing\r\n"
        self.assertEqual(mr.parse_multipart(body, b"absent"), {})


class TestImageSniffing(unittest.TestCase):
    def test_detects_formats_by_magic_bytes(self):
        self.assertEqual(mr.sniff_image_ext(JPEG), "jpg")
        self.assertEqual(mr.sniff_image_ext(PNG), "png")
        self.assertEqual(mr.sniff_image_ext(b"RIFF\0\0\0\0WEBPmore"), "webp")
        self.assertEqual(mr.sniff_image_ext(b"GIF89a..."), "gif")

    def test_rejects_non_images(self):
        # The important failure: text or JSON must never be forwarded as a frame.
        self.assertIsNone(mr.sniff_image_ext(b'{"error":"not an image"}'))
        self.assertIsNone(mr.sniff_image_ext(b""))

    def test_data_url_uses_sniffed_type_over_declared(self):
        # A mislabelled upload must not be handed to the vision model with a
        # wrong MIME type.
        url = mr.to_data_url(JPEG, "image/png")
        self.assertIsNotNone(url)
        assert url is not None  # narrowing for the type checker
        self.assertTrue(url.startswith("data:image/jpeg;base64,"))

    def test_data_url_is_none_for_non_image(self):
        self.assertIsNone(mr.to_data_url(b"plain text", "image/jpeg"))


class TestSpool(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        mr.STATE_DIR = root
        mr.UPLOAD_DIR = root / "uploads"
        mr.ARCHIVE_DIR = root / "forwarded"
        mr.SPOOL_DIR = root / "spool"
        mr.ensure_dirs()

    def tearDown(self):
        self.tmp.cleanup()

    def test_spool_then_see_as_pending(self):
        uid = mr.spool_upload(JPEG, {"requestId": "r1"})
        self.assertEqual(uid, "r1")
        pending = mr.pending_uploads()
        self.assertEqual([p.stem for p in pending], ["r1"])

    def test_sidecar_is_written_after_the_image(self):
        # The sidecar is the commit marker. If it exists, the image must too.
        uid = mr.spool_upload(JPEG, {"requestId": "r2"})
        self.assertTrue((mr.UPLOAD_DIR / f"{uid}.bin").exists())
        self.assertTrue((mr.SPOOL_DIR / f"{uid}.json").exists())

    def test_no_sidecar_means_not_pending(self):
        # An image with no sidecar is an interrupted write and must be ignored.
        (mr.UPLOAD_DIR / "orphan.bin").write_bytes(JPEG)
        self.assertEqual(mr.pending_uploads(), [])

    def test_archived_uploads_drop_out_of_the_queue(self):
        uid = mr.spool_upload(JPEG, {"requestId": "r3"})
        (mr.ARCHIVE_DIR / f"{uid}.json").write_text("{}")
        self.assertEqual(mr.pending_uploads(), [])

    def test_hostile_request_id_cannot_escape_the_state_dir(self):
        # requestId comes from the uploader; it must never become a path.
        uid = mr.spool_upload(JPEG, {"requestId": "../../../../etc/passwd"})
        self.assertNotIn("/", uid)
        self.assertNotIn("..", uid)
        self.assertFalse(uid.startswith("."))
        written = list(mr.UPLOAD_DIR.glob("*.bin"))
        self.assertEqual(len(written), 1)
        self.assertEqual(written[0].parent, mr.UPLOAD_DIR)

    def test_pathological_request_ids_get_a_generated_name(self):
        for hostile in ("..", ".", "...", "_", "-", "", "/", "\\\\", "./.."):
            uid = mr.spool_upload(JPEG, {"requestId": hostile})
            self.assertTrue(uid, f"empty id from {hostile!r}")
            self.assertFalse(uid.startswith("."), f"dotfile from {hostile!r}")
            self.assertNotIn("/", uid)
            self.assertNotIn("\\", uid)
        # All of them landed inside the upload dir, none escaped.
        self.assertEqual(len(list(mr.UPLOAD_DIR.glob("*.bin"))), 9)

    def test_generates_an_id_when_none_supplied(self):
        uid = mr.spool_upload(JPEG, {})
        self.assertTrue(uid)
        self.assertEqual(len(mr.pending_uploads()), 1)

    def test_queue_is_oldest_first(self):
        import os, time
        first = mr.spool_upload(JPEG, {"requestId": "old"})
        time.sleep(0.01)
        second = mr.spool_upload(PNG, {"requestId": "new"})
        self.assertEqual([p.stem for p in mr.pending_uploads()], ["old", "new"])
        for p in mr.SPOOL_DIR.glob("*.json"):
            os.utime(p, (p.stat().st_mtime, p.stat().st_mtime))
        self.assertEqual({first, second}, {p.stem for p in mr.pending_uploads()})


class TestPruning(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        mr.STATE_DIR = root
        mr.UPLOAD_DIR = root / "uploads"
        mr.ARCHIVE_DIR = root / "forwarded"
        mr.SPOOL_DIR = root / "spool"
        mr.ensure_dirs()

    def tearDown(self):
        self.tmp.cleanup()

    def test_prunes_only_old_archived_uploads(self):
        import os, time
        old = mr.spool_upload(JPEG, {"requestId": "old"})
        fresh = mr.spool_upload(JPEG, {"requestId": "fresh"})
        for uid in (old, fresh):
            (mr.ARCHIVE_DIR / f"{uid}.json").write_text("{}")

        stale = time.time() - 90 * 86400
        for p in (mr.SPOOL_DIR / f"{old}.json", mr.ARCHIVE_DIR / f"{old}.json",
                  mr.UPLOAD_DIR / f"{old}.bin"):
            os.utime(p, (stale, stale))

        mr.prune_archive(keep_days=30)

        self.assertFalse((mr.UPLOAD_DIR / f"{old}.bin").exists())
        self.assertFalse((mr.ARCHIVE_DIR / f"{old}.json").exists())
        # The fresh one survives.
        self.assertTrue((mr.UPLOAD_DIR / f"{fresh}.bin").exists())

    def test_prune_never_touches_unforwarded_uploads(self):
        # An unforwarded capture is the only copy. Deleting it would lose a hive
        # visit, so age alone must never be enough to remove it.
        import os, time
        uid = mr.spool_upload(JPEG, {"requestId": "never-sent"})
        stale = time.time() - 400 * 86400
        for p in (mr.SPOOL_DIR / f"{uid}.json", mr.UPLOAD_DIR / f"{uid}.bin"):
            os.utime(p, (stale, stale))

        mr.prune_archive(keep_days=30)

        self.assertTrue((mr.UPLOAD_DIR / f"{uid}.bin").exists())
        self.assertEqual(len(mr.pending_uploads()), 1)


class TestForwarding(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        mr.STATE_DIR = root
        mr.UPLOAD_DIR = root / "uploads"
        mr.ARCHIVE_DIR = root / "forwarded"
        mr.SPOOL_DIR = root / "spool"
        mr.ensure_dirs()
        self.cfg = {"beetree_url": "http://beetree.test", "beetree_key": "k"}

    def tearDown(self):
        self.tmp.cleanup()

    def _capture_urlopen(self, exc=None, status=200, body=None):
        calls = []

        class FakeResp:
            def __init__(self, payload):
                self._payload = payload
                self.status = status

            def read(self):
                return self._payload

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake(req, timeout=None):
            calls.append(req)
            if exc:
                raise exc
            return FakeResp(json.dumps(body or {"speech": "ok"}).encode())

        self._orig = mr.request.urlopen
        setattr(mr.request, "urlopen", fake)
        return calls

    def test_successful_forward_archives_and_sends_the_image(self):
        uid = mr.spool_upload(JPEG, {"requestId": "f1", "transcript": "hive bravo"})
        calls = self._capture_urlopen(body={"speech": "solid brood"})
        try:
            self.assertTrue(mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg))
        finally:
            setattr(mr.request, "urlopen", self._orig)

        sent = json.loads(calls[0].data)
        self.assertTrue(sent["image"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(sent["source"], "mentra-live")
        self.assertEqual(sent["transcript"], "hive bravo")
        # Bearer token is passed through — BeeTree requires auth on this route.
        self.assertEqual(calls[0].headers["Authorization"], "Bearer k")
        self.assertTrue((mr.ARCHIVE_DIR / f"{uid}.json").exists())
        self.assertEqual(mr.pending_uploads(), [])

    def test_network_failure_keeps_the_upload_queued(self):
        uid = mr.spool_upload(JPEG, {"requestId": "f2"})
        self._capture_urlopen(exc=mr.error.URLError("unreachable"))
        try:
            self.assertFalse(mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg))
        finally:
            setattr(mr.request, "urlopen", self._orig)

        # The whole point: a hive visit is never lost to a dead network.
        self.assertEqual(len(mr.pending_uploads()), 1)
        self.assertFalse((mr.ARCHIVE_DIR / f"{uid}.json").exists())

    def test_server_error_keeps_the_upload_queued(self):
        uid = mr.spool_upload(JPEG, {"requestId": "f3"})
        self._capture_urlopen(exc=mr.error.HTTPError(
            "u", 500, "boom", {}, io.BytesIO(b"server exploded")))
        try:
            self.assertFalse(mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg))
        finally:
            setattr(mr.request, "urlopen", self._orig)
        self.assertEqual(len(mr.pending_uploads()), 1)

    def test_rate_limit_keeps_the_upload_queued(self):
        # 429 must retry: the vision call is what rate-limits, not the request.
        uid = mr.spool_upload(JPEG, {"requestId": "f4"})
        self._capture_urlopen(exc=mr.error.HTTPError(
            "u", 429, "slow down", {}, io.BytesIO(b"rate limited")))
        try:
            self.assertFalse(mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg))
        finally:
            setattr(mr.request, "urlopen", self._orig)
        self.assertEqual(len(mr.pending_uploads()), 1)

    def test_permanent_rejection_is_archived_so_it_cannot_block_the_queue(self):
        # A malformed image would otherwise retry forever and stall every later
        # upload behind it.
        uid = mr.spool_upload(JPEG, {"requestId": "f5"})
        self._capture_urlopen(exc=mr.error.HTTPError(
            "u", 400, "bad request", {}, io.BytesIO(b"not decodable")))
        try:
            self.assertTrue(mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg))
        finally:
            setattr(mr.request, "urlopen", self._orig)
        self.assertEqual(mr.pending_uploads(), [])
        self.assertTrue((mr.ARCHIVE_DIR / f"{uid}.json").exists())

    def test_non_image_spool_entry_is_dropped_not_retried(self):
        uid = mr.spool_upload(b"this is not an image", {"requestId": "f6"})
        # No HTTP call should happen at all.
        calls = self._capture_urlopen()
        try:
            self.assertTrue(mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg))
        finally:
            setattr(mr.request, "urlopen", self._orig)
        self.assertEqual(calls, [])
        self.assertEqual(mr.pending_uploads(), [])

    def test_unreadable_sidecar_does_not_crash_the_worker(self):
        bad = mr.SPOOL_DIR / "bad.json"
        bad.write_text("{ not json")
        calls = self._capture_urlopen()
        try:
            self.assertFalse(mr.forward_one(bad, self.cfg))
        finally:
            setattr(mr.request, "urlopen", self._orig)

    def test_hive_name_is_folded_into_transcript(self):
        # BeeTree has no hiveName field; a name only takes effect as transcript
        # text. Dropping it silently produced captures with hive=None.
        uid = mr.spool_upload(JPEG, {"requestId": "h1", "hiveName": "Hive Bravo"})
        calls = self._capture_urlopen()
        try:
            mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg)
        finally:
            setattr(mr.request, "urlopen", self._orig)

        sent = json.loads(calls[0].data)
        self.assertNotIn("hiveName", sent)          # not a field the server reads
        self.assertIn("Hive Bravo", sent["transcript"])

    def test_hive_name_merges_with_an_existing_transcript(self):
        uid = mr.spool_upload(JPEG, {"requestId": "h2",
                                     "hiveName": "Hive Bravo",
                                     "transcript": "brood looks spotty"})
        calls = self._capture_urlopen()
        try:
            mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg)
        finally:
            setattr(mr.request, "urlopen", self._orig)

        t = json.loads(calls[0].data)["transcript"]
        self.assertIn("brood looks spotty", t)
        self.assertIn("Hive Bravo", t)

    def test_hive_name_is_not_duplicated_when_already_spoken(self):
        uid = mr.spool_upload(JPEG, {"requestId": "h3", "hiveName": "Hive Bravo",
                                     "transcript": "at hive bravo now"})
        calls = self._capture_urlopen()
        try:
            mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg)
        finally:
            setattr(mr.request, "urlopen", self._orig)
        t = json.loads(calls[0].data)["transcript"].lower()
        self.assertEqual(t.count("bravo"), 1)

    def test_explicit_hive_id_wins_over_the_name(self):
        # An explicit picker selection is stronger evidence than a parsed name.
        uid = mr.spool_upload(JPEG, {"requestId": "h4", "hiveId": "hive-2",
                                     "hiveName": "Hive Bravo"})
        calls = self._capture_urlopen()
        try:
            mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg)
        finally:
            setattr(mr.request, "urlopen", self._orig)
        sent = json.loads(calls[0].data)
        self.assertEqual(sent["hiveId"], "hive-2")
        self.assertNotIn("transcript", sent)  # no invented narration

    def test_hive_id_snake_case_is_accepted(self):
        uid = mr.spool_upload(JPEG, {"requestId": "h5", "hive_id": "hive-3"})
        calls = self._capture_urlopen()
        try:
            mr.forward_one(mr.SPOOL_DIR / f"{uid}.json", self.cfg)
        finally:
            setattr(mr.request, "urlopen", self._orig)
        self.assertEqual(json.loads(calls[0].data)["hiveId"], "hive-3")


if __name__ == "__main__":
    unittest.main(verbosity=2)
