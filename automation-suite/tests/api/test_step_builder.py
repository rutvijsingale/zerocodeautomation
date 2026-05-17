"""
Suite : step_builder
Layer : API
Owner : ZAC Platform QA

Verifies the Gherkin <-> step-definition linkage validator behind
`POST /api/validate`.
"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/step_builder.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.step_builder
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize("case", FIX["valid_step_lists"], ids=lambda c: c["id"])
@allure.title("Validate happy step list: {case[id]}")
def test_validate_positive(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.validate_steps(case["steps"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "valid" in body
    assert "summary" in body and isinstance(body["summary"]["total"], int)


@pytest.mark.api
@pytest.mark.step_builder
@pytest.mark.edge
@pytest.mark.parametrize("case", FIX["empty_lists"], ids=lambda c: c["id"])
@allure.title("Empty step list yields empty summary, not 5xx: {case[id]}")
def test_validate_empty(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.validate_steps(case["steps"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"]["total"] == 0
    assert body["summary"]["matched"] == 0


@pytest.mark.api
@pytest.mark.step_builder
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["malformed_lists"], ids=lambda c: c["id"])
@allure.title("Malformed step list does not 5xx: {case[id]}")
def test_validate_malformed(api_client: ZacApiClient, case: dict) -> None:
    """Server is permissive but must never throw a 5xx on malformed steps."""
    payload = {"steps": case["steps"]} if isinstance(case["steps"], list) else case["steps"]
    resp = api_client._request("POST", "/validate", json_body=payload)  # type: ignore[attr-defined]
    assert resp.status_code < 500, (
        f"Server crashed on malformed steps for case {case['id']}: {resp.status_code}"
    )
