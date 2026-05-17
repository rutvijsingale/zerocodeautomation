"""
Suite : lifecycle
Layer : API
Owner : ZAC Platform QA

Sanity probe for the long-lived server. We do not actually trigger SIGTERM
in CI - graceful shutdown is verified manually + via logs - but we verify
the public read-only contracts that consumers of `lifecycle` rely on.
"""

from __future__ import annotations

import os
from pathlib import Path

import allure
import pytest
import requests
import yaml

from utils.api_client import ZacApiClient

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/lifecycle.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.lifecycle
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("/api/health responds with 200 and at least a status field")
def test_health(api_client: ZacApiClient) -> None:
    resp = api_client.health()
    assert resp.status_code == 200, resp.text
    body = resp.json()
    keys = set(body.keys())
    assert keys & set(FIX["required_health_fields"] + FIX["optional_health_fields"]), (
        f"health body missing required/optional fields: {body}"
    )


@pytest.mark.api
@pytest.mark.lifecycle
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("/api/config exposes app metadata")
def test_config(api_client: ZacApiClient) -> None:
    resp = api_client.config()
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, dict) and len(body) > 0


@pytest.mark.api
@pytest.mark.lifecycle
@pytest.mark.positive
@allure.title("Static /index.html is served")
def test_static_index_served() -> None:
    base = os.getenv("ZAC_UI_BASE_URL", "http://localhost:3000").rstrip("/")
    resp = requests.get(base + "/", timeout=5)
    assert resp.status_code == 200
    assert "<html" in resp.text.lower()
