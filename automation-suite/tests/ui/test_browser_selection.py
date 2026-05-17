"""
Suite : browser_selection
Layer : UI
Owner : ZAC Platform QA
"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest
import yaml

from pages.browser_selection_page import BrowserSelectionPage

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/browser_selection.yaml").read_text()
)


@pytest.mark.ui
@pytest.mark.browser_selection
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("Browser dropdown lists the expected engines")
def test_browser_options_present(smart_page) -> None:
    page = BrowserSelectionPage(smart_page).open().assert_loaded()
    options = page.available_options()
    for expected in FIX["expected_options"]:
        assert expected in options, f"missing {expected} in {options}"


@pytest.mark.ui
@pytest.mark.browser_selection
@pytest.mark.positive
@pytest.mark.parametrize("browser", FIX["expected_options"])
@allure.title("Selecting `{browser}` updates the dropdown value")
def test_select_browser(smart_page, browser: str) -> None:
    page = BrowserSelectionPage(smart_page).open().assert_loaded()
    page.select(browser)
    assert page.find(page.LOC_BROWSER_SELECT).input_value() == browser
