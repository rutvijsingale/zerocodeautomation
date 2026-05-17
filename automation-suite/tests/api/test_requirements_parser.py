"""
Suite : requirements_parser
Layer : API
Owner : ZAC Platform QA

Drives the SRS upload, traceability, and Gherkin generation endpoints.
We synthesize a small but realistic SRS at runtime so the test does not
depend on test fixtures stored as binary files.
"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest
import yaml

from utils.api_client import ZacApiClient
from utils.sample_files import (
    write_empty_txt,
    write_sample_srs_txt,
    write_unsupported_binary,
)

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/requirements_parser.yaml").read_text()
)


@pytest.mark.api
@pytest.mark.requirements_parser
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("Parse a canonical SRS document")
def test_parse_canonical_srs(api_client: ZacApiClient) -> None:
    path = write_sample_srs_txt()
    resp = api_client.requirements_parse(path)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert len(body["requirements"]) >= FIX["expected_min_requirements"]
    assert len(body["testScenarios"]) >= FIX["expected_min_scenarios"]
    for k in FIX["expected_summary_keys"]:
        assert k in body["summary"]


@pytest.mark.api
@pytest.mark.requirements_parser
@pytest.mark.negative
@allure.title("Empty document is rejected with a meaningful error")
def test_parse_empty_doc(api_client: ZacApiClient) -> None:
    path = write_empty_txt()
    resp = api_client.requirements_parse(path)
    assert resp.status_code in {400, 500}, resp.text


@pytest.mark.api
@pytest.mark.requirements_parser
@pytest.mark.security
@allure.title("Unsupported MIME type / extension is rejected")
def test_parse_unsupported(api_client: ZacApiClient) -> None:
    path = write_unsupported_binary()
    resp = api_client.requirements_parse(path)
    assert resp.status_code in {400, 500}, resp.text


@pytest.mark.api
@pytest.mark.requirements_parser
@pytest.mark.positive
@allure.title("Generate Gherkin from a list of scenarios")
def test_generate_feature(api_client: ZacApiClient) -> None:
    payload = FIX["generate_feature_payloads"]["valid"]
    resp = api_client.requirements_generate_feature(payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    gherkin = body["gherkin"]
    assert "Feature:" in gherkin
    for sc in payload["scenarios"]:
        assert sc["title"] in gherkin


@pytest.mark.api
@pytest.mark.requirements_parser
@pytest.mark.negative
@pytest.mark.parametrize(
    "case",
    FIX["generate_feature_payloads"]["invalid"],
    ids=lambda c: c["id"],
)
@allure.title("Reject invalid generate-feature payload: {case[id]}")
def test_generate_feature_invalid(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.requirements_generate_feature(case["payload"])
    assert resp.status_code in case["expected_status_set"]


@pytest.mark.api
@pytest.mark.requirements_parser
@pytest.mark.positive
@allure.title("Traceability matrix wires requirements to scenarios")
def test_traceability(api_client: ZacApiClient) -> None:
    parsed = api_client.requirements_parse(write_sample_srs_txt()).json()
    resp = api_client.requirements_traceability(
        {
            "requirements": parsed["requirements"],
            "scenarios": parsed["testScenarios"],
        }
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert "coverage" in body["traceability"]
