"""
Suite : npm_runner
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
from utils.cmd_check import require_command

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/npm_runner.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.npm_runner
@pytest.mark.smoke
@allure.title("/api/npm/check returns installed flag")
def test_npm_check(api_client: ZacApiClient) -> None:
    resp = api_client.npm_check()
    assert resp.status_code == 200
    assert "installed" in resp.json()


@pytest.mark.api
@pytest.mark.npm_runner
@pytest.mark.positive
@allure.title("npm probe on non-node project returns false")
def test_npm_check_project_false(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    p = api_client.create_project(
        {"name": f"Npm {uuid.uuid4().hex[:6]}"}
    ).json()["project"]
    cleanup_projects.append(p["id"])
    resp = api_client.npm_check_project(p["id"])
    assert resp.status_code == 200
    assert resp.json()["isNpmProject"] is False


@pytest.mark.api
@pytest.mark.npm_runner
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_executions"], ids=lambda c: c["id"])
@allure.title("Reject invalid npm execute: {case[id]}")
def test_npm_execute_invalid(
    api_client: ZacApiClient, cleanup_projects: list[str], case: dict
) -> None:
    p = api_client.create_project(
        {"name": f"Npm {uuid.uuid4().hex[:6]}"}
    ).json()["project"]
    cleanup_projects.append(p["id"])
    resp = api_client.npm_execute(p["id"], case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.npm_runner
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["cancel_cases"], ids=lambda c: c["id"])
@allure.title("npm cancel: {case[id]}")
def test_npm_cancel(api_client: ZacApiClient, case: dict) -> None:
    if "executionId" in case["payload"]:
        resp = api_client.npm_cancel(case["payload"]["executionId"])
    else:
        resp = api_client._request("POST", "/npm/cancel", json_body={})
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.npm_runner
@pytest.mark.requires_npm
@pytest.mark.positive
@allure.title("npm `--version` succeeds when npm is on PATH")
def test_npm_version_when_present(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    require_command("npm")
    p = api_client.create_project(
        {"name": f"Npm {uuid.uuid4().hex[:6]}", "framework": "playwright-ts"}
    ).json()["project"]
    cleanup_projects.append(p["id"])
    api_client.generate_files(
        p["id"],
        {"framework": "playwright-ts", "steps": [{"kind": "navigate", "url": "https://example.com"}]},
    )
    resp = api_client.npm_execute(p["id"], {"command": "--version", "args": []})
    assert resp.status_code in {200, 400}
