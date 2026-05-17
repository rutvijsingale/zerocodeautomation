"""
Suite : project_management
Layer : UI (Playwright)
Owner : ZAC Platform QA

End-to-end UI verification of the project selector + CRUD bar in
`public/index.html`. Uses the `ProjectManagementPage` POM with the
self-healing `LocatorChain`, smart waits only (no `time.sleep`),
and atomic teardown via the `cleanup_projects` fixture.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import allure
import pytest
import yaml

from pages.project_management_page import ProjectManagementPage
from utils.api_client import ZacApiClient
from utils.logger import get_logger, log_step
from utils.retry import retry_assert

log = get_logger(__name__)
FIXTURES = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/project_management.yaml").read_text()
)


def _ui(smart_page) -> ProjectManagementPage:
    return ProjectManagementPage(smart_page).open(
        base_url=os.getenv("ZAC_UI_BASE_URL", "http://localhost:3000")
    ).assert_loaded()


# ============================================================
#                         POSITIVE
# ============================================================


@pytest.mark.ui
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("Home page renders project selector")
def test_home_renders_selector(smart_page) -> None:
    page = _ui(smart_page)
    assert page.find(page.LOC_PROJECT_DROPDOWN).is_visible()
    assert page.find(page.LOC_NEW_PROJECT_BTN).is_visible()
    assert page.find(page.LOC_CLEAR_BTN).is_visible()


@pytest.mark.ui
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("Newly-created project appears in dropdown")
def test_created_project_appears_in_dropdown(
    smart_page, api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    name = f"UI Smoke {uuid.uuid4().hex[:8]}"
    log_step(log, "create via api", name=name)
    created = api_client.create_project({"name": name}).json()["project"]
    cleanup_projects.append(created["id"])

    page = _ui(smart_page)

    @retry_assert(attempts=6, base_seconds=0.5)
    def _dropdown_has_name() -> None:
        smart_page.reload(wait_until="networkidle")
        page.assert_loaded()
        names = page.list_project_names()
        assert any(name in n for n in names), f"Project '{name}' missing from dropdown: {names}"

    _dropdown_has_name()


@pytest.mark.ui
@pytest.mark.positive
@pytest.mark.parametrize(
    "valid",
    FIXTURES["valid_projects"],
    ids=lambda v: v["name"].replace(" ", "_").lower(),
)
@allure.title("Dropdown selects project: {valid[name]}")
def test_select_project_in_dropdown(
    smart_page,
    api_client: ZacApiClient,
    cleanup_projects: list[str],
    valid: dict,
) -> None:
    payload = {**valid, "name": f"{valid['name']} {uuid.uuid4().hex[:6]}"}
    created = api_client.create_project(payload).json()["project"]
    cleanup_projects.append(created["id"])

    page = _ui(smart_page)
    smart_page.reload(wait_until="networkidle")
    page.assert_loaded()
    page.select_project_by_label(payload["name"])

    assert page.is_save_visible() or page.is_delete_visible(), (
        "Selecting a project should reveal Save/Delete actions"
    )


# ============================================================
#                          NEGATIVE
# ============================================================


@pytest.mark.ui
@pytest.mark.negative
@allure.title("Selecting placeholder option keeps Save/Delete hidden")
def test_placeholder_keeps_actions_hidden(smart_page) -> None:
    page = _ui(smart_page)
    page.click_clear()

    @retry_assert(attempts=4)
    def _hidden() -> None:
        assert not page.is_save_visible(), "Save button should be hidden when no project selected"
        assert not page.is_delete_visible(), "Delete button should be hidden when no project selected"

    _hidden()


# ============================================================
#                            EDGE
# ============================================================


@pytest.mark.ui
@pytest.mark.edge
@allure.title("Page survives reload with no projects gracefully")
def test_reload_with_no_selection_recovers(smart_page) -> None:
    page = _ui(smart_page)
    smart_page.reload(wait_until="networkidle")
    page.assert_loaded()
    assert page.find(page.LOC_HEADER_TITLE).is_visible()
