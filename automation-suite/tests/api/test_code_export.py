"""
Suite : code_export
Layer : API + filesystem
Owner : ZAC Platform QA

Drives `POST /api/export` across the (framework x browserType) matrix.
After each export we assert that the produced project tree on disk
contains the expected anchor files (pom.xml / package.json / feature file).
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient

REPO_ROOT = Path(__file__).resolve().parents[3]
FIX = yaml.safe_load(
    (REPO_ROOT / "automation-suite/fixtures/code_export.yaml").read_text()
)


def _project_dir(project_id: str) -> Path:
    return REPO_ROOT / "projects" / project_id


@pytest.mark.api
@pytest.mark.code_export
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize("framework", FIX["frameworks"])
@pytest.mark.parametrize("browser", FIX["browsers"])
@allure.title("Export {framework} for {browser}")
def test_export_matrix(
    api_client: ZacApiClient,
    cleanup_projects: list[str],
    framework: str,
    browser: str,
) -> None:
    project = api_client.create_project(
        {"name": f"Export {framework} {browser} {uuid.uuid4().hex[:6]}"}
    ).json()["project"]
    cleanup_projects.append(project["id"])

    resp = api_client.export(
        {
            "projectId": project["id"],
            "framework": framework,
            "browserType": browser,
            "steps": FIX["minimal_steps"],
            "baseUrl": "https://example.com",
        }
    )
    assert resp.status_code == 200, resp.text

    proj_dir = _project_dir(project["id"])
    if framework.endswith("-java"):
        assert (proj_dir / "pom.xml").exists(), f"pom.xml missing in {proj_dir}"
    else:
        # playwright-ts emits a feature file at minimum
        produced = list(proj_dir.rglob("*.feature")) + list(proj_dir.rglob("*.ts"))
        assert produced, f"No TS/feature artefacts produced under {proj_dir}"


@pytest.mark.api
@pytest.mark.code_export
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_payloads"], ids=lambda c: c["id"])
@allure.title("Export rejects invalid payload: {case[id]}")
def test_export_invalid(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.export(case["payload"])
    assert resp.status_code in case["expected_status_set"], (
        f"Got {resp.status_code} for {case['id']} - body: {resp.text[:200]}"
    )


@pytest.mark.api
@pytest.mark.code_export
@pytest.mark.edge
@allure.title("Re-exporting the same project is idempotent")
def test_re_export_is_idempotent(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    project = api_client.create_project(
        {"name": f"Re-export {uuid.uuid4().hex[:6]}"}
    ).json()["project"]
    cleanup_projects.append(project["id"])

    payload = {
        "projectId": project["id"],
        "framework": "playwright-ts",
        "browserType": "chromium",
        "steps": FIX["minimal_steps"],
    }
    first = api_client.export(payload)
    second = api_client.export(payload)
    assert first.status_code == 200 and second.status_code == 200
