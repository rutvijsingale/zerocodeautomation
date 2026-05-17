"""
Page Object: Project Management.

Models the project selector + CRUD bar at the top of the ZAC IDE
(`public/index.html`):

    - #project-dropdown          : <select>
    - #new-project-btn           : "New Project (Optional)"
    - #save-project-btn
    - #delete-project-btn
    - #clear-project-btn
    - #project-status            : status text

Selector chain is built so the HealerEngine can fall back to role/text
lookups if the IDs ever drift.

Owner: ZAC Platform QA
Suite : project_management
"""

from __future__ import annotations

from utils.locator_strategy import LocatorSpec
from utils.logger import get_logger, log_step

from .base_page import BasePage

log = get_logger(__name__)


class ProjectManagementPage(BasePage):
    URL_PATH = "/"

    # ---- Locator specs (multi-strategy for self-healing) ----

    LOC_PROJECT_DROPDOWN = LocatorSpec(
        name="project_dropdown",
        testid="project-dropdown",
        id_="project-dropdown",
        role="combobox",
        css="select#project-dropdown",
    )
    LOC_NEW_PROJECT_BTN = LocatorSpec(
        name="new_project_btn",
        testid="new-project-btn",
        id_="new-project-btn",
        role="button",
        role_name="New Project (Optional)",
        text="New Project",
    )
    LOC_SAVE_PROJECT_BTN = LocatorSpec(
        name="save_project_btn",
        testid="save-project-btn",
        id_="save-project-btn",
        role="button",
        role_name="Save Project",
        text="Save Project",
    )
    LOC_DELETE_PROJECT_BTN = LocatorSpec(
        name="delete_project_btn",
        testid="delete-project-btn",
        id_="delete-project-btn",
        role="button",
        role_name="Delete Project",
        text="Delete Project",
    )
    LOC_CLEAR_BTN = LocatorSpec(
        name="clear_btn",
        testid="clear-project-btn",
        id_="clear-project-btn",
        role="button",
        text="Clear",
    )
    LOC_STATUS = LocatorSpec(
        name="project_status",
        testid="project-status",
        id_="project-status",
    )
    LOC_HEADER_TITLE = LocatorSpec(
        name="header_title",
        testid="app-title",
        id_="app-title",
        role="heading",
    )

    # ---------------- Actions ----------------

    def assert_loaded(self) -> "ProjectManagementPage":
        log_step(log, "assert page loaded")
        self.wait_visible(self.LOC_HEADER_TITLE)
        self.wait_visible(self.LOC_PROJECT_DROPDOWN)
        return self

    def list_project_names(self) -> list[str]:
        dropdown = self.find(self.LOC_PROJECT_DROPDOWN)
        return [
            (t or "").strip()
            for t in dropdown.locator("option").all_inner_texts()
            if (t or "").strip() and not t.startswith("--")
        ]

    def select_project_by_label(self, label: str) -> "ProjectManagementPage":
        log_step(log, "select project", label=label)
        dropdown = self.find(self.LOC_PROJECT_DROPDOWN)
        dropdown.select_option(label=label)
        return self

    def click_new_project(self) -> "ProjectManagementPage":
        log_step(log, "click new project")
        self.wait_visible(self.LOC_NEW_PROJECT_BTN).click()
        return self

    def click_clear(self) -> "ProjectManagementPage":
        log_step(log, "click clear")
        self.wait_visible(self.LOC_CLEAR_BTN).click()
        return self

    def status_text(self) -> str:
        return (self.find(self.LOC_STATUS).inner_text() or "").strip()

    def is_save_visible(self) -> bool:
        try:
            return self.find(self.LOC_SAVE_PROJECT_BTN).is_visible()
        except LookupError:
            return False

    def is_delete_visible(self) -> bool:
        try:
            return self.find(self.LOC_DELETE_PROJECT_BTN).is_visible()
        except LookupError:
            return False
