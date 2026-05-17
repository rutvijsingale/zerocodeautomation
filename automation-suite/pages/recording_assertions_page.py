"""
Page Object: Recording Assertions.

Thin extension over `RecordingSessionPage` that focuses on the assertion-
capture portion of the recording flow (see `RECORDING_ASSERTIONS_README.md`).

Owner: ZAC Platform QA
Suite : recording_assertions
"""

from __future__ import annotations

from utils.locator_strategy import LocatorSpec
from utils.logger import get_logger

from .recording_session_page import RecordingSessionPage

log = get_logger(__name__)


class RecordingAssertionsPage(RecordingSessionPage):
    LOC_LIVE_FEATURE_TEXT = LocatorSpec(
        name="live_feature_overlay",
        testid="code-feature-overlay",
        id_="code-feature-overlay",
    )

    def feature_text(self) -> str:
        return (self.find(self.LOC_LIVE_FEATURE_TEXT).input_value() or "").strip()
