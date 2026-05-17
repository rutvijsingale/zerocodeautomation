"""
Suite : project_management
Layer : Visual regression (Playwright snapshot)
Owner : ZAC Platform QA

Captures pixel snapshots for the project-selector header strip. Baselines are
stored under `tests/visual/__snapshots__/` and committed to the repo. To
update baselines locally:

    pytest tests/visual --update-snapshots

CI fails on diff > 0.2 % pixels (Playwright default `maxDiffPixelRatio`).
"""

from __future__ import annotations

import os

import allure
import pytest
from playwright.sync_api import expect

from pages.project_management_page import ProjectManagementPage


@pytest.mark.visual
@pytest.mark.smoke
@allure.title("Header strip matches baseline snapshot")
def test_header_strip_visual(smart_page) -> None:
    page = ProjectManagementPage(smart_page).open(
        base_url=os.getenv("ZAC_UI_BASE_URL", "http://localhost:3000")
    ).assert_loaded()

    header = page.find(page.LOC_HEADER_TITLE)
    expect(header).to_have_screenshot(
        "header-title.png",
        max_diff_pixel_ratio=0.002,
    )


@pytest.mark.visual
@allure.title("Project selector strip matches baseline snapshot")
def test_selector_strip_visual(smart_page) -> None:
    page = ProjectManagementPage(smart_page).open(
        base_url=os.getenv("ZAC_UI_BASE_URL", "http://localhost:3000")
    ).assert_loaded()

    dropdown = page.find(page.LOC_PROJECT_DROPDOWN)
    expect(dropdown).to_have_screenshot(
        "project-dropdown.png",
        max_diff_pixel_ratio=0.002,
    )
