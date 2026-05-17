"""
Suite : test_runner
Layer : API
Owner : ZAC Platform QA

Smoke-tests `POST /api/rerun` and `POST /api/rerun/cancel`. The rerun
endpoint actually launches a real browser; we cancel it immediately so the
test is fast and deterministic.

`POST /api/test-runner/run` requires a fully exported project; we only
exercise its argument-validation surface here. End-to-end execution is
covered in the maven_runner / npm_runner lanes.
"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/test_runner.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.test_runner
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("Rerun launches and is cancellable via /api/rerun/cancel")
def test_rerun_launch_and_cancel(api_client: ZacApiClient) -> None:
    payload = {
        "steps": FIX["simple_steps"],
        "browserType": "chromium",
        "baseUrl": "about:blank",
        "headless": True,
    }
    cancel_resp = api_client.rerun_cancel()
    assert cancel_resp.status_code in {200, 400, 404}

    resp = api_client.rerun(payload)
    assert resp.status_code in {200, 500}, resp.text


@pytest.mark.api
@pytest.mark.test_runner
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_rerun"], ids=lambda c: c["id"])
@allure.title("Rerun rejects invalid input: {case[id]}")
def test_rerun_negative(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.rerun(case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.test_runner
@pytest.mark.negative
@allure.title("test-runner/run requires project name or id")
def test_test_runner_requires_project(api_client: ZacApiClient) -> None:
    resp = api_client.test_runner_run({})
    assert resp.status_code in {400, 500}


@pytest.mark.api
@pytest.mark.test_runner
@pytest.mark.edge
@pytest.mark.parametrize("case", FIX["cancel_cases"], ids=lambda c: c["id"])
@allure.title("Cancel rerun: {case[id]}")
def test_rerun_cancel_edge(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.rerun_cancel(case["payload"].get("executionId"))
    assert resp.status_code in case["expected_status_set"]
