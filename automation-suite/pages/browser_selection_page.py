"""
Page Object: Browser Selection.

Thin POM wrapping the `#browserType` <select> and verifying that the IDE's
allowed browser values match `BROWSER_SELECTION_FEATURE.md`:
    - chromium  (default)
    - firefox
    - webkit
    - edge       (only when running on Windows; ZAC accepts the value)

Owner: ZAC Platform QA
Suite : browser_selection
"""

from __future__ import annotations

from utils.locator_strategy import LocatorSpec
from utils.logger import get_logger, log_step

from .base_page import BasePage

log = get_logger(__name__)


class BrowserSelectionPage(BasePage):
    URL_PATH = "/"

    LOC_BROWSER_SELECT = LocatorSpec(
        name="browser_type_select",
        testid="browserType",
        id_="browserType",
        role="combobox",
    )

    EXPECTED_OPTIONS = ("chromium", "firefox", "webkit")

    def assert_loaded(self) -> "BrowserSelectionPage":
        self.wait_visible(self.LOC_BROWSER_SELECT)
        return self

    def select(self, browser: str) -> "BrowserSelectionPage":
        log_step(log, "select browser", browser=browser)
        self.find(self.LOC_BROWSER_SELECT).select_option(value=browser)
        return self

    def available_options(self) -> list[str]:
        sel = self.find(self.LOC_BROWSER_SELECT)
        return [
            (v or "").strip()
            for v in sel.locator("option").evaluate_all(
                "(els) => els.map(e => e.value)"
            )
            if (v or "").strip()
        ]
