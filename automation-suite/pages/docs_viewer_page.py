"""
Page Object: Markdown Docs Viewer.

Models the standalone `public/markdown-viewer.html` and the five
documentation routes registered in `server.js`:

    /USER_MANUAL.md
    /QUICK_START_GUIDE.md
    /TEST_CASE_DESIGN_GUIDE.md
    /AUTOMATION_ENGINEER_GUIDE.md
    /SCENARIO_OUTLINE_GUIDE.md

Owner: ZAC Platform QA
Suite : docs_viewer
"""

from __future__ import annotations

from utils.locator_strategy import LocatorSpec
from utils.logger import get_logger

from .base_page import BasePage

log = get_logger(__name__)


class DocsViewerPage(BasePage):
    URL_PATH = "/markdown-viewer.html"

    LOC_CONTAINER = LocatorSpec(
        name="docs_container",
        testid="docs-container",
        css=".container",
    )
    LOC_HEADING = LocatorSpec(
        name="docs_heading",
        css=".container h1",
        role="heading",
    )

    def assert_loaded(self) -> "DocsViewerPage":
        self.wait_visible(self.LOC_CONTAINER)
        return self
