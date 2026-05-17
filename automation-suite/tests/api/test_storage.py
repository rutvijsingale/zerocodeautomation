"""
Suite : storage
Layer : API
Owner : ZAC Platform QA
"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/storage.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.storage
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("/api/storage/stats returns storage + sessions blocks")
def test_storage_stats(api_client: ZacApiClient) -> None:
    resp = api_client.storage_stats()
    assert resp.status_code == 200, resp.text
    body = resp.json()
    for k in FIX["required_top_keys"]:
        assert k in body, f"missing top-level key {k} in {body.keys()}"
    storage_keys = set(body["storage"].keys())
    for k in FIX["storage_min_keys"]:
        assert k in storage_keys
    sessions_keys = set(body["sessions"].keys())
    for k in FIX["sessions_min_keys"]:
        assert k in sessions_keys
