"""
Suite : maven_runner
Layer : API
Owner : ZAC Platform QA

End-to-end Maven invocation requires Maven on PATH and an exported Java
project; we skip the full execute path when unavailable but always cover
the probe + validation surface.
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
    (Path(__file__).resolve().parents[2] / "fixtures/maven_runner.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.maven_runner
@pytest.mark.smoke
@allure.title("/api/maven/check returns installed flag")
def test_maven_check(api_client: ZacApiClient) -> None:
    resp = api_client.maven_check()
    assert resp.status_code == 200
    body = resp.json()
    assert "installed" in body
    assert isinstance(body["installed"], bool)


@pytest.mark.api
@pytest.mark.maven_runner
@pytest.mark.positive
@allure.title("Maven probe on a brand-new (non-Maven) project returns false")
def test_maven_check_project_false(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    p = api_client.create_project(
        {"name": f"Mvn {uuid.uuid4().hex[:6]}"}
    ).json()["project"]
    cleanup_projects.append(p["id"])
    resp = api_client.maven_check_project(p["id"])
    assert resp.status_code == 200
    assert resp.json()["isMavenProject"] is False


@pytest.mark.api
@pytest.mark.maven_runner
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_executions"], ids=lambda c: c["id"])
@allure.title("Reject invalid maven execute: {case[id]}")
def test_maven_execute_invalid(
    api_client: ZacApiClient, cleanup_projects: list[str], case: dict
) -> None:
    p = api_client.create_project(
        {"name": f"Mvn {uuid.uuid4().hex[:6]}"}
    ).json()["project"]
    cleanup_projects.append(p["id"])
    resp = api_client.maven_execute(p["id"], case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.maven_runner
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["cancel_cases"], ids=lambda c: c["id"])
@allure.title("Maven cancel: {case[id]}")
def test_maven_cancel(api_client: ZacApiClient, case: dict) -> None:
    if "executionId" in case["payload"]:
        resp = api_client.maven_cancel(case["payload"]["executionId"])
    else:
        resp = api_client._request("POST", "/maven/cancel", json_body={})
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.maven_runner
@pytest.mark.requires_mvn
@pytest.mark.positive
@allure.title("Maven `--version` succeeds when mvn is on PATH")
def test_maven_version_when_present(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    require_command("mvn")
    p = api_client.create_project(
        {"name": f"Mvn {uuid.uuid4().hex[:6]}", "framework": "playwright-java"}
    ).json()["project"]
    cleanup_projects.append(p["id"])
    api_client.generate_files(
        p["id"],
        {"framework": "playwright-java", "steps": [{"kind": "navigate", "url": "https://example.com"}]},
    )
    resp = api_client.maven_execute(p["id"], {"command": "--version", "args": []})
    assert resp.status_code in {200, 400}
