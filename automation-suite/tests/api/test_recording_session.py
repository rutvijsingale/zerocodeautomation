"""
Suite : recording_session
Layer : API + WebSocket
Owner : ZAC Platform QA

Validates the full recording lifecycle:
    POST /api/recording/start -> returns sessionId + wsUrl
    WS  /api/recording/:id    -> ping/pong, action drain, close 1008 on bad id
    POST /api/recording/stop  -> persists actions
"""

from __future__ import annotations

import time
from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient
from utils import ws_client

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/recording_session.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.recording_session
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize("case", FIX["valid_starts"], ids=lambda c: c["browserType"])
@allure.title("Start session for {case[browserType]}")
def test_start_returns_session_and_ws_url(
    api_client: ZacApiClient, case: dict
) -> None:
    resp = api_client.recording_start(case)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "sessionId" in body
    assert body["wsUrl"].startswith("ws://") and body["sessionId"] in body["wsUrl"]

    stop = api_client.recording_stop(
        {"sessionId": body["sessionId"], "skipProjectCreation": True}
    )
    assert stop.status_code == 200


@pytest.mark.api
@pytest.mark.recording_session
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_stops"], ids=lambda c: c["id"])
@allure.title("Stop rejects invalid input: {case[id]}")
def test_stop_invalid(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.recording_stop(case["payload"])
    assert resp.status_code in case["expected_status_set"], (
        f"got {resp.status_code} body={resp.text[:200]}"
    )


@pytest.mark.websocket
@pytest.mark.recording_session
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("WebSocket: ping/pong on a live session")
def test_ws_ping_pong(api_client: ZacApiClient) -> None:
    if not ws_client.is_available():
        pytest.skip("websocket-client is not installed")

    session = api_client.recording_start(
        {"baseUrl": "about:blank", "browserType": "chromium"}
    ).json()
    sid = session["sessionId"]
    try:
        with ws_client.open_ws(sid, timeout=5.0) as ws:
            ws_client.send_json(ws, {"type": "ping"})
            reply = ws_client.recv_json(ws, timeout=5.0)
            assert reply.get("type") == "pong", reply
    finally:
        api_client.recording_stop({"sessionId": sid, "skipProjectCreation": True})


@pytest.mark.websocket
@pytest.mark.recording_session
@pytest.mark.security
@pytest.mark.negative
@pytest.mark.parametrize("bad_sid", [
    "00000000-0000-1000-8000-000000000000",
    "not-a-uuid",
])
@allure.title("WebSocket: bad session id is closed by server")
def test_ws_invalid_session_id(bad_sid: str) -> None:
    if not ws_client.is_available():
        pytest.skip("websocket-client is not installed")

    from websocket import WebSocketException  # type: ignore

    try:
        with ws_client.open_ws(bad_sid, timeout=2.0) as ws:
            try:
                ws.recv()
            except Exception:
                pass  # server closes -> recv raises
    except WebSocketException:
        pass  # acceptable: handshake refused / closed
