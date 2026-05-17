"""
Suite : project_management
Layer : Accessibility (axe-core via axe-playwright-python)
Owner : ZAC Platform QA

Scans the ZAC IDE landing page for WCAG 2.1 AA violations using axe-core.
A test fails on any 'critical' or 'serious' violation; lower-severity issues
are reported but not blocking (tracked in Allure attachments).
"""

from __future__ import annotations

import json
import os

import allure
import pytest
from axe_playwright_python.sync_playwright import Axe

from pages.project_management_page import ProjectManagementPage
from utils.logger import get_logger

log = get_logger(__name__)

BLOCKING = {"critical", "serious"}
WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]


@pytest.mark.accessibility
@pytest.mark.smoke
@allure.title("Home page has no critical/serious WCAG 2.1 AA violations")
def test_home_a11y(smart_page) -> None:
    ProjectManagementPage(smart_page).open(
        base_url=os.getenv("ZAC_UI_BASE_URL", "http://localhost:3000")
    ).assert_loaded()

    axe = Axe()
    results = axe.run(smart_page, options={"runOnly": {"type": "tag", "values": WCAG_TAGS}})

    blocking = [
        v for v in results.response.get("violations", []) if v.get("impact") in BLOCKING
    ]

    allure.attach(
        json.dumps(results.response.get("violations", []), indent=2),
        name="axe-violations",
        attachment_type=allure.attachment_type.JSON,
    )

    log.info(
        "a11y scan",
        extra={
            "event": "a11y.scan",
            "total": len(results.response.get("violations", [])),
            "blocking": len(blocking),
        },
    )

    assert not blocking, (
        f"Critical/Serious WCAG violations: {[v['id'] for v in blocking]}"
    )
