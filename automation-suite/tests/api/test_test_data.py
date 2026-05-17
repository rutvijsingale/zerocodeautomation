"""
Suite : test_data
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
    (Path(__file__).resolve().parents[2] / "fixtures/test_data.yaml").read_text()
)


@pytest.fixture()
def project(api_client: ZacApiClient, cleanup_projects: list[str]) -> dict:
    p = api_client.create_project({"name": f"TestData {uuid.uuid4().hex[:6]}"}).json()["project"]
    cleanup_projects.append(p["id"])
    return p


@pytest.mark.api
@pytest.mark.test_data
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize("ds", FIX["valid_sets"], ids=lambda d: d["name"])
@allure.title("Save test data set: {ds[name]}")
def test_save_test_data_set(api_client: ZacApiClient, project: dict, ds: dict) -> None:
    resp = api_client.save_test_data(project["id"], ds)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["testDataSet"]["name"] == ds["name"]
    assert body["testDataSet"]["examples"] == ds["examples"]


@pytest.mark.api
@pytest.mark.test_data
@pytest.mark.positive
@allure.title("Saved test data set appears in list")
def test_list_test_data(api_client: ZacApiClient, project: dict) -> None:
    for ds in FIX["valid_sets"]:
        api_client.save_test_data(project["id"], ds)
    resp = api_client.list_test_data(project["id"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] >= len(FIX["valid_sets"])


@pytest.mark.api
@pytest.mark.test_data
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_sets"], ids=lambda c: c["id"])
@allure.title("Reject invalid test data: {case[id]}")
def test_save_invalid(api_client: ZacApiClient, project: dict, case: dict) -> None:
    resp = api_client.save_test_data(project["id"], case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.test_data
@pytest.mark.edge
@pytest.mark.parametrize("case", FIX["edge_sets"], ids=lambda c: c["id"])
@allure.title("Edge data set: {case[id]}")
def test_save_edge(api_client: ZacApiClient, project: dict, case: dict) -> None:
    resp = api_client.save_test_data(project["id"], case["payload"])
    assert resp.status_code in case["expected_status_set"]
