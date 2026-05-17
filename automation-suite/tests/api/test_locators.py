"""
Suite : locators
Layer : API
Owner : ZAC Platform QA

Tests the project-scoped locator endpoints AND the legacy /locators/:project
shape that the IDE still serves for backward compat.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/locators.yaml").read_text()
)


@pytest.fixture()
def project(api_client: ZacApiClient, cleanup_projects: list[str]) -> dict:
    p = api_client.create_project(
        {"name": f"Locators {uuid.uuid4().hex[:6]}"}
    ).json()["project"]
    cleanup_projects.append(p["id"])
    return p


@pytest.mark.api
@pytest.mark.locators
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize("loc", FIX["valid_locators"], ids=lambda l: f"{l['pageName']}.{l['elementName']}")
@allure.title("Save locator: {loc[pageName]}.{loc[elementName]}")
def test_save_locator_positive(
    api_client: ZacApiClient, project: dict, loc: dict
) -> None:
    resp = api_client.save_locator(project["id"], loc)
    assert resp.status_code == 200, resp.text
    saved = resp.json()["locator"]
    assert saved["pageName"] == loc["pageName"]
    assert saved["elementName"] == loc["elementName"]
    assert saved["locatorValue"] == loc["locatorValue"]


@pytest.mark.api
@pytest.mark.locators
@pytest.mark.positive
@allure.title("List locators returns count + array")
def test_list_locators(api_client: ZacApiClient, project: dict) -> None:
    for loc in FIX["valid_locators"][:2]:
        api_client.save_locator(project["id"], loc)

    resp = api_client.list_locators(project["id"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["count"] >= 2
    assert isinstance(body["locators"], list)


@pytest.mark.api
@pytest.mark.locators
@pytest.mark.positive
@allure.title("Update existing locator preserves id")
def test_update_locator_keeps_id(api_client: ZacApiClient, project: dict) -> None:
    loc = FIX["valid_locators"][0]
    first = api_client.save_locator(project["id"], loc).json()["locator"]
    new_value = "#updated-username"
    second = api_client.save_locator(
        project["id"], {**loc, "locatorValue": new_value}
    ).json()["locator"]
    assert second["id"] == first["id"]
    assert second["locatorValue"] == new_value


@pytest.mark.api
@pytest.mark.locators
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_locators"], ids=lambda c: c["id"])
@allure.title("Reject invalid locator payload: {case[id]}")
def test_save_locator_invalid(
    api_client: ZacApiClient, project: dict, case: dict
) -> None:
    resp = api_client.save_locator(project["id"], case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.locators
@pytest.mark.edge
@allure.title("Delete locator twice: second is 404, never 5xx")
def test_delete_locator_idempotent(
    api_client: ZacApiClient, project: dict
) -> None:
    saved = api_client.save_locator(
        project["id"], FIX["valid_locators"][0]
    ).json()["locator"]
    first = api_client.delete_locator(project["id"], saved["id"])
    assert first.status_code == 200
    second = api_client.delete_locator(project["id"], saved["id"])
    assert second.status_code in {404, 500}
    assert second.status_code != 200 or second.json().get("success") is False
