"""
Suite : test_case_generator
Layer : API
Owner : ZAC Platform QA
"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/test_case_generator.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.test_case_generator
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize("case", FIX["valid_inputs"], ids=lambda c: c["id"])
@allure.title("Generate test cases from steps: {case[id]}")
def test_generate_positive(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.generate_test_cases(case["payload"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("success") is True or "testCases" in body
    if "testCases" in body:
        assert isinstance(body["testCases"], list)


@pytest.mark.api
@pytest.mark.test_case_generator
@pytest.mark.negative
@pytest.mark.parametrize("case", FIX["invalid_inputs"], ids=lambda c: c["id"])
@allure.title("Reject invalid generator input: {case[id]}")
def test_generate_negative(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.generate_test_cases(case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.test_case_generator
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("generate-step-definitions returns Java code for playwright-java")
def test_generate_step_definitions(api_client: ZacApiClient) -> None:
    resp = api_client.generate_step_definitions(
        {
            "framework": "playwright-java",
            "steps": [
                {"kind": "navigate", "url": "https://example.com"},
                {"kind": "click", "selector": "#login"},
            ],
            "featureTitle": "Login Flow",
        }
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert isinstance(body["stepDefinitions"], str)
    assert "class" in body["stepDefinitions"]
