"""
Suite : environments
Layer : API
Owner : ZAC Platform QA
"""

from __future__ import annotations

import uuid
from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/environments.yaml").read_text()
)


@pytest.fixture()
def created_envs(api_client: ZacApiClient) -> list[str]:
    """Track env names created in this test for atomic teardown."""
    created: list[str] = []
    yield created
    for name in created:
        try:
            api_client.delete_environment(name)
        except Exception:
            pass


@pytest.mark.api
@pytest.mark.environments
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize("env", FIX["valid_envs"], ids=lambda e: e["name"])
@allure.title("Save environment: {env[name]}")
def test_save_environment(
    api_client: ZacApiClient, created_envs: list[str], env: dict
) -> None:
    unique_name = f"{env['name']}-{uuid.uuid4().hex[:4]}"
    payload = {**env, "name": unique_name}
    resp = api_client.save_environment(payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["environment"]["name"] == unique_name
    assert body["environment"]["baseUrl"] == env["baseUrl"]
    created_envs.append(unique_name)


@pytest.mark.api
@pytest.mark.environments
@pytest.mark.positive
@allure.title("Get environment by name returns saved record")
def test_get_environment(
    api_client: ZacApiClient, created_envs: list[str]
) -> None:
    name = f"GETTABLE-{uuid.uuid4().hex[:4]}"
    api_client.save_environment(
        {"name": name, "baseUrl": "https://x.example.com"}
    )
    created_envs.append(name)
    resp = api_client.get_environment(name)
    assert resp.status_code == 200
    assert resp.json()["environment"]["name"] == name


@pytest.mark.api
@pytest.mark.environments
@pytest.mark.negative
@allure.title("Get unknown environment returns 404")
def test_get_unknown_env(api_client: ZacApiClient) -> None:
    resp = api_client.get_environment("DEFINITELY-NOT-A-REAL-ENV-XYZ")
    assert resp.status_code == 404


@pytest.mark.api
@pytest.mark.environments
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_envs"], ids=lambda c: c["id"])
@allure.title("Reject invalid env: {case[id]}")
def test_save_invalid(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.save_environment(case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.environments
@pytest.mark.edge
@allure.title("Delete env twice: second is 404")
def test_delete_idempotent(api_client: ZacApiClient) -> None:
    name = f"TODELETE-{uuid.uuid4().hex[:4]}"
    api_client.save_environment(
        {"name": name, "baseUrl": "https://x.example.com"}
    )
    first = api_client.delete_environment(name)
    assert first.status_code == 200
    second = api_client.delete_environment(name)
    assert second.status_code == 404
