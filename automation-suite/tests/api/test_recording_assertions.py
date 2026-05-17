"""
Suite : recording_assertions
Layer : API
Owner : ZAC Platform QA

For each captured assertion action, verify that the resulting Java step
definitions contain a matching method body. This is what the IDE uses to
turn "assertText" / "assertVisible" / etc. into Cucumber Then steps.
"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/recording_assertions.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.recording_assertions
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize(
    "case",
    FIX["assertion_actions"],
    ids=lambda c: c["id"],
)
@allure.title("Assertion `{case[id]}` round-trips into step definitions")
def test_assertion_roundtrip(api_client: ZacApiClient, case: dict) -> None:
    payload = {
        "framework": "playwright-java",
        "steps": [
            {"kind": "navigate", "url": "https://example.com"},
            case["action"],
        ],
        "featureTitle": f"Assertion {case['id']}",
    }
    resp = api_client.generate_step_definitions(payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    code = body["stepDefinitions"]
    assert "class" in code
    # Step definitions should at least contain the assertion kind keyword
    assert case["action"]["kind"] in code or case["id"].split("_")[1] in code.lower()
