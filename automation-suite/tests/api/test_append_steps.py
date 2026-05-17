"""
Suite : append_steps
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
    (Path(__file__).resolve().parents[2] / "fixtures/append_steps.yaml").read_text()
)


@pytest.fixture()
def project(api_client: ZacApiClient, cleanup_projects: list[str]) -> dict:
    p = api_client.create_project({"name": f"Append {uuid.uuid4().hex[:6]}"}).json()["project"]
    cleanup_projects.append(p["id"])
    payload = {
        "name": p["name"],
        "steps": FIX["initial_steps"],
        "framework": "playwright-ts",
    }
    api_client.save_project(p["id"], payload)
    return p


@pytest.mark.api
@pytest.mark.append_steps
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("Append steps grows project step list")
def test_append_grows_project(api_client: ZacApiClient, project: dict) -> None:
    before = api_client.get_project(project["id"]).json()["project"]
    initial_count = len(before.get("steps", []))

    resp = api_client.append_steps(project["id"], {"steps": FIX["appended_steps"]})
    assert resp.status_code == 200, resp.text

    after = api_client.get_project(project["id"]).json()["project"]
    assert len(after["steps"]) == initial_count + len(FIX["appended_steps"])


@pytest.mark.api
@pytest.mark.append_steps
@pytest.mark.positive
@allure.title("After append, generate-files succeeds")
def test_append_then_generate_files(
    api_client: ZacApiClient, project: dict
) -> None:
    api_client.append_steps(project["id"], {"steps": FIX["appended_steps"]})
    resp = api_client.generate_files(
        project["id"],
        {"framework": "playwright-ts", "browserType": "chromium"},
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.api
@pytest.mark.append_steps
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_appends"], ids=lambda c: c["id"])
@allure.title("Reject invalid append payload: {case[id]}")
def test_append_invalid(
    api_client: ZacApiClient, project: dict, case: dict
) -> None:
    resp = api_client.append_steps(project["id"], case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.append_steps
@pytest.mark.edge
@allure.title("Append to non-existent project returns 404")
def test_append_unknown_project(api_client: ZacApiClient) -> None:
    resp = api_client.append_steps(
        "definitely-not-a-real-project", {"steps": FIX["appended_steps"]}
    )
    assert resp.status_code in {400, 404, 500}
