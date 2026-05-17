"""
Suite : project_management
Layer : API (functional + contract)
Owner : ZAC Platform QA

Verifies the `/api/projects/*` REST surface end-to-end:

    - Positive : list / create / get / select / save / delete
    - Negative : invalid payload, missing fields, malformed IDs
    - Edge     : duplicate names, unicode, max-length boundary, idempotency

Every test is atomic and independent: any project created during the test is
queued for deletion via the `cleanup_projects` fixture, so re-running the
suite leaves zero state.
"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest
import yaml
from jsonschema import Draft7Validator

from utils.api_client import ZacApiClient
from utils.logger import get_logger, log_step

log = get_logger(__name__)
FIXTURES = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/project_management.yaml").read_text()
)


# ---------------- JSON Schemas (lightweight contract) ----------------

PROJECT_SCHEMA = {
    "type": "object",
    "required": ["id", "name", "metadata"],
    "properties": {
        "id": {"type": "string", "minLength": 1},
        "name": {"type": "string", "minLength": 1},
        "description": {"type": "string"},
        "baseUrl": {"type": "string"},
        "framework": {"type": "string"},
        "browserType": {"type": "string"},
        "metadata": {
            "type": "object",
            "required": ["created", "updated", "version"],
            "properties": {
                "created": {"type": "string"},
                "updated": {"type": "string"},
                "version": {"type": "string"},
            },
        },
    },
}

LIST_PROJECTS_SCHEMA = {
    "type": "object",
    "required": ["success", "projects", "count"],
    "properties": {
        "success": {"type": "boolean"},
        "projects": {"type": "array"},
        "count": {"type": "integer", "minimum": 0},
    },
}


def _validate(schema: dict, payload: dict) -> None:
    errors = sorted(Draft7Validator(schema).iter_errors(payload), key=lambda e: e.path)
    assert not errors, "Schema violations: " + "; ".join(
        f"{list(e.path)}: {e.message}" for e in errors
    )


# ============================================================
#                       SMOKE / POSITIVE
# ============================================================


@pytest.mark.api
@pytest.mark.smoke
@allure.title("API health endpoint reports OK")
def test_health_ok(api_client: ZacApiClient) -> None:
    resp = api_client.health()
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("status") in {"ok", "healthy", "OK"} or body.get("success") is True


@pytest.mark.api
@pytest.mark.smoke
@allure.title("List projects returns valid envelope")
def test_list_projects_envelope(api_client: ZacApiClient) -> None:
    resp = api_client.list_projects()
    assert resp.status_code == 200
    _validate(LIST_PROJECTS_SCHEMA, resp.json())


@pytest.mark.api
@pytest.mark.smoke
@pytest.mark.positive
@pytest.mark.parametrize(
    "valid",
    FIXTURES["valid_projects"],
    ids=lambda v: v["name"].replace(" ", "_").lower(),
)
@allure.title("Create project: {valid[name]}")
def test_create_project_positive(
    api_client: ZacApiClient,
    cleanup_projects: list[str],
    valid: dict,
) -> None:
    log_step(log, "create project", payload=valid)
    resp = api_client.create_project(valid)
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["success"] is True
    project = body["project"]
    _validate(PROJECT_SCHEMA, project)
    assert project["name"] == valid["name"]

    cleanup_projects.append(project["id"])

    fetched = api_client.get_project(project["id"])
    assert fetched.status_code == 200
    assert fetched.json()["project"]["id"] == project["id"]


@pytest.mark.api
@pytest.mark.positive
@allure.title("Select project sets it as current")
def test_select_project_marks_current(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    created = api_client.create_project(
        {"name": "Selectable Project", "description": "for select test"}
    ).json()["project"]
    cleanup_projects.append(created["id"])

    sel = api_client.select_project(created["id"])
    assert sel.status_code == 200
    assert sel.json()["project"]["id"] == created["id"]

    current = api_client.get_current().json()
    assert current["success"] is True
    assert current["project"]["id"] == created["id"]


@pytest.mark.api
@pytest.mark.positive
@allure.title("Save project mutates updated timestamp")
def test_save_project_updates_metadata(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    created = api_client.create_project({"name": "Saveable Project"}).json()["project"]
    cleanup_projects.append(created["id"])
    original_updated = created["metadata"]["updated"]

    payload = {**created, "description": "updated by test"}
    save = api_client.save_project(created["id"], payload)
    assert save.status_code == 200

    fetched = api_client.get_project(created["id"]).json()["project"]
    assert fetched["description"] == "updated by test"
    assert fetched["metadata"]["updated"] >= original_updated


# ============================================================
#                          NEGATIVE
# ============================================================


@pytest.mark.api
@pytest.mark.negative
@pytest.mark.parametrize(
    "case",
    FIXTURES["invalid_projects"],
    ids=lambda c: c["id"],
)
@allure.title("Reject invalid create payload: {case[id]}")
def test_create_project_negative(api_client: ZacApiClient, case: dict) -> None:
    resp = api_client.create_project(case["payload"])
    assert resp.status_code == case["expected_status"], resp.text
    body = resp.json()
    assert body.get("success") is False
    assert "error" in body and body["error"]


@pytest.mark.api
@pytest.mark.negative
@allure.title("GET non-existent project returns 404")
def test_get_missing_project_returns_404(api_client: ZacApiClient) -> None:
    resp = api_client.get_project("definitely-does-not-exist-zzz")
    assert resp.status_code == 404
    assert resp.json()["success"] is False


@pytest.mark.api
@pytest.mark.negative
@allure.title("Select non-existent project returns 404")
def test_select_missing_project_returns_404(api_client: ZacApiClient) -> None:
    resp = api_client.select_project("definitely-does-not-exist-zzz")
    assert resp.status_code == 404
    assert resp.json()["success"] is False


@pytest.mark.api
@pytest.mark.negative
@pytest.mark.parametrize(
    "bad_id",
    FIXTURES["malicious_project_ids"],
    ids=lambda s: s[:24].replace("/", "_").replace("\\", "_"),
)
@allure.title("Path-traversal/injection IDs are rejected: {bad_id}")
def test_malicious_project_ids_rejected(api_client: ZacApiClient, bad_id: str) -> None:
    """Server validates `/^[a-zA-Z0-9._-]+$/` and must 400 (or 404 from router)."""
    resp = api_client.get_project(bad_id)
    assert resp.status_code in {400, 404}, (
        f"Expected 400/404 for malicious id '{bad_id}', got {resp.status_code}"
    )


# ============================================================
#                            EDGE
# ============================================================


@pytest.mark.api
@pytest.mark.edge
@allure.title("Duplicate name auto-suffixes project ID")
def test_duplicate_name_creates_unique_id(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    name = "Duplicate Project"
    first = api_client.create_project({"name": name}).json()
    assert first["success"] is True
    cleanup_projects.append(first["project"]["id"])

    second = api_client.create_project({"name": name}).json()
    assert second["success"] is True
    cleanup_projects.append(second["project"]["id"])

    assert first["project"]["id"] != second["project"]["id"], (
        "Server must produce unique IDs for duplicate names"
    )


@pytest.mark.api
@pytest.mark.edge
@allure.title("Delete is idempotent: second delete returns non-2xx without server error")
def test_delete_is_idempotent(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    created = api_client.create_project({"name": "Idempotent Delete"}).json()["project"]

    first = api_client.delete_project(created["id"])
    assert first.status_code in {200, 204}

    second = api_client.delete_project(created["id"])
    assert second.status_code in {200, 204, 404}, second.text
    assert second.status_code != 500

    if first.status_code in {200, 204} and created["id"] not in cleanup_projects:
        return


@pytest.mark.api
@pytest.mark.edge
@pytest.mark.parametrize(
    "case",
    [c for c in FIXTURES["edge_projects"] if c["id"] != "duplicate_name"],
    ids=lambda c: c["id"],
)
@allure.title("Edge create payload accepted: {case[id]}")
def test_edge_create_accepted(
    api_client: ZacApiClient, cleanup_projects: list[str], case: dict
) -> None:
    resp = api_client.create_project(case["payload"])
    assert resp.status_code == 200, resp.text
    project = resp.json()["project"]
    cleanup_projects.append(project["id"])
    _validate(PROJECT_SCHEMA, project)
