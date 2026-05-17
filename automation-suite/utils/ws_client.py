"""
Minimal WebSocket client for the ZAC recording channel.

Used by the `recording_session` and `recording_assertions` test layers to:
    - Verify the upgrade handshake
    - Send / receive `ping` / `pong`
    - Drain queued actions (the server flushes them on connect)
    - Assert close codes for invalid session IDs (1008)

We deliberately use the stdlib `websockets`-free approach (raw HTTP-Upgrade
via `requests` is not feasible) - so this module attempts to import the
optional `websocket-client` package and skips the test cleanly if it is not
installed in the current lane.

Owner: ZAC Platform QA
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from typing import Iterator, Optional

try:
    from websocket import WebSocket, WebSocketException  # type: ignore
    _AVAILABLE = True
except Exception:  # pragma: no cover
    WebSocket = None  # type: ignore
    WebSocketException = Exception  # type: ignore
    _AVAILABLE = False


def is_available() -> bool:
    return _AVAILABLE


def ws_url_for(session_id: str) -> str:
    base = os.getenv("ZAC_UI_BASE_URL", "http://localhost:3000")
    base_ws = base.replace("https://", "wss://").replace("http://", "ws://")
    return f"{base_ws.rstrip('/')}/api/recording/{session_id}"


@contextmanager
def open_ws(
    session_id: str,
    *,
    timeout: float = 5.0,
) -> Iterator["WebSocket"]:
    if not _AVAILABLE:
        raise RuntimeError(
            "websocket-client is not installed; "
            "add `websocket-client==1.8.0` to requirements.txt or skip the test."
        )
    ws = WebSocket()
    ws.settimeout(timeout)
    ws.connect(ws_url_for(session_id))
    try:
        yield ws
    finally:
        try:
            ws.close()
        except Exception:
            pass


def send_json(ws: "WebSocket", payload: dict) -> None:
    ws.send(json.dumps(payload))


def recv_json(ws: "WebSocket", *, timeout: Optional[float] = None) -> dict:
    if timeout is not None:
        ws.settimeout(timeout)
    raw = ws.recv()
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    return json.loads(raw)
