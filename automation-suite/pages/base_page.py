"""
BasePage - common Page Object scaffold for the ZAC UI.

Implements the Page Object Model (POM) + Screenplay-style action methods.
Every interaction goes through `LocatorChain.resolve()` so that the
HealerEngine can record fallbacks.

Owner: ZAC Platform QA
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from utils.locator_strategy import LocatorChain, LocatorSpec
from utils.logger import get_logger, log_step

if TYPE_CHECKING:
    from playwright.sync_api import Locator, Page

log = get_logger(__name__)


class BasePage:
    """Common base for every Page Object in the suite."""

    URL_PATH: str = "/"

    def __init__(self, page: "Page") -> None:
        self.page = page

    # ---------------- Navigation ----------------

    def open(self, *, base_url: str | None = None) -> "BasePage":
        """Smart navigation: waits for `domcontentloaded`, then for network idle."""
        target = (base_url or "").rstrip("/") + self.URL_PATH if base_url else self.URL_PATH
        log_step(log, "navigate", url=target)
        self.page.goto(target, wait_until="domcontentloaded")
        self.page.wait_for_load_state("networkidle")
        return self

    # ---------------- Element resolution ----------------

    def find(self, spec: LocatorSpec) -> "Locator":
        """Resolve a `LocatorSpec` via the self-healing chain."""
        return LocatorChain(self.page, spec).resolve()

    # ---------------- Smart waits ----------------

    def wait_visible(self, spec: LocatorSpec, *, timeout_ms: int = 10_000) -> "Locator":
        loc = self.find(spec)
        loc.wait_for(state="visible", timeout=timeout_ms)
        return loc

    def wait_hidden(self, spec: LocatorSpec, *, timeout_ms: int = 10_000) -> None:
        try:
            loc = self.find(spec)
            loc.wait_for(state="hidden", timeout=timeout_ms)
        except LookupError:
            return
