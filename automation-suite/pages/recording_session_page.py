"""
Page Object: Recording Session.

Models the recording controls and overlay in `public/index.html`:
    - #startRecording / #stopRecording / #pauseRecording  (main panel)
    - #recordingOverlay + #stopRecordingOverlay / #pauseRecordingOverlay
    - #recordingStatus / #recordingOverlayStatus
    - #baseUrl / #featureTitle / #projectName  (form inputs)
    - #code-feature-overlay / #code-steps-overlay  (live Gherkin / steps)

Owner: ZAC Platform QA
Suite : recording_session
"""

from __future__ import annotations

from utils.locator_strategy import LocatorSpec
from utils.logger import get_logger, log_step

from .base_page import BasePage

log = get_logger(__name__)


class RecordingSessionPage(BasePage):
    URL_PATH = "/"

    LOC_BASE_URL = LocatorSpec(
        name="base_url_input", testid="baseUrl", id_="baseUrl", label="Base URL"
    )
    LOC_FEATURE_TITLE = LocatorSpec(
        name="feature_title_input",
        testid="featureTitle",
        id_="featureTitle",
        label="Feature Title",
    )
    LOC_PROJECT_NAME = LocatorSpec(
        name="project_name_input",
        testid="projectName",
        id_="projectName",
    )
    LOC_BROWSER_TYPE = LocatorSpec(
        name="browser_type_select",
        testid="browserType",
        id_="browserType",
        role="combobox",
    )
    LOC_START_BTN = LocatorSpec(
        name="start_recording",
        testid="startRecording",
        id_="startRecording",
        role="button",
        text="Start Recording",
    )
    LOC_STOP_BTN = LocatorSpec(
        name="stop_recording",
        testid="stopRecording",
        id_="stopRecording",
        role="button",
        text="Stop Recording",
    )
    LOC_PAUSE_BTN = LocatorSpec(
        name="pause_recording",
        testid="pauseRecording",
        id_="pauseRecording",
        role="button",
    )
    LOC_RECORDING_STATUS = LocatorSpec(
        name="recording_status",
        testid="recordingStatus",
        id_="recordingStatus",
    )
    LOC_OVERLAY = LocatorSpec(
        name="recording_overlay",
        testid="recordingOverlay",
        id_="recordingOverlay",
    )
    LOC_OVERLAY_STOP = LocatorSpec(
        name="overlay_stop",
        testid="stopRecordingOverlay",
        id_="stopRecordingOverlay",
        role="button",
    )
    LOC_OVERLAY_PAUSE = LocatorSpec(
        name="overlay_pause",
        testid="pauseRecordingOverlay",
        id_="pauseRecordingOverlay",
        role="button",
    )
    LOC_LIVE_FEATURE = LocatorSpec(
        name="live_feature_overlay",
        testid="code-feature-overlay",
        id_="code-feature-overlay",
        css="textarea#code-feature-overlay",
    )
    LOC_LIVE_STEPS = LocatorSpec(
        name="live_steps_overlay",
        testid="code-steps-overlay",
        id_="code-steps-overlay",
        css="textarea#code-steps-overlay",
    )

    def assert_loaded(self) -> "RecordingSessionPage":
        self.wait_visible(self.LOC_START_BTN)
        return self

    def fill_intake(
        self,
        *,
        base_url: str = "",
        feature_title: str = "",
        project_name: str = "",
        browser: str = "chromium",
    ) -> "RecordingSessionPage":
        log_step(
            log,
            "fill recording intake",
            base_url=base_url,
            feature_title=feature_title,
            project_name=project_name,
            browser=browser,
        )
        self.find(self.LOC_BASE_URL).fill(base_url or "")
        self.find(self.LOC_FEATURE_TITLE).fill(feature_title or "")
        self.find(self.LOC_PROJECT_NAME).fill(project_name or "")
        self.find(self.LOC_BROWSER_TYPE).select_option(value=browser)
        return self

    def click_start(self) -> "RecordingSessionPage":
        self.wait_visible(self.LOC_START_BTN).click()
        return self

    def click_stop_overlay(self) -> "RecordingSessionPage":
        self.wait_visible(self.LOC_OVERLAY_STOP).click()
        return self
