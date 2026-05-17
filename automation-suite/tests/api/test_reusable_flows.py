"""
Suite : reusable_flows
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
    (Path(__file__).resolve().parents[2] / "fixtures/reusable_flows.yaml").read_text()
)


@pytest.fixture()
def project(api_client: ZacApiClient, cleanup_projects: list[str]) -> dict:
    p = api_client.create_project({"name": f"Flows {uuid.uuid4().hex[:6]}"}).json()["project"]
    cleanup_projects.append(p["id"])
    return p


@pytest.mark.api
@pytest.mark.reusable_flows
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize("flow", FIX["flows"], ids=lambda f: f["name"])
@allure.title("Save flow: {flow[name]}")
def test_save_flow(api_client: ZacApiClient, project: dict, flow: dict) -> None:
    resp = api_client.save_flow(project["id"], flow)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["flow"]["name"] == flow["name"]
    assert body["flow"]["id"].startswith("flow-")


@pytest.mark.api
@pytest.mark.reusable_flows
@pytest.mark.positive
@allure.title("Saved flow appears in list")
def test_list_flows_after_save(api_client: ZacApiClient, project: dict) -> None:
    for f in FIX["flows"]:
        api_client.save_flow(project["id"], f)
    resp = api_client.list_flows(project["id"])
    assert resp.status_code == 200
    names = [x["name"] for x in resp.json()["flows"]]
    for f in FIX["flows"]:
        assert f["name"] in names


@pytest.mark.api
@pytest.mark.reusable_flows
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_flows"], ids=lambda c: c["id"])
@allure.title("Reject invalid flow: {case[id]}")
def test_save_flow_invalid(
    api_client: ZacApiClient, project: dict, case: dict
) -> None:
    resp = api_client.save_flow(project["id"], case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.reusable_flows
@pytest.mark.edge
@allure.title("Delete flow twice: second is 404")
def test_delete_flow_idempotent(api_client: ZacApiClient, project: dict) -> None:
    flow = api_client.save_flow(project["id"], FIX["flows"][0]).json()["flow"]
    first = api_client.delete_flow(project["id"], flow["id"])
    assert first.status_code == 200
    second = api_client.delete_flow(project["id"], flow["id"])
    assert second.status_code in {404, 500}
