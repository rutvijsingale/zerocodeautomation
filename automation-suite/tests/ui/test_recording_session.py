"""
Suite : recording_session
Layer : UI
Owner : ZAC Platform QA

Loads the IDE, fills the recording intake form, asserts that all the
controls referenced by the recording flow are present and reachable.
We deliberately do NOT click "Start Recording" here - that opens a real
controlled browser which is covered by the API/WS layer instead.
"""

from __future__ import annotations

import allure
import pytest

from pages.recording_session_page import RecordingSessionPage


@pytest.mark.ui
@pytest.mark.recording_session
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("Recording controls render with self-healing locators")
def test_recording_controls_render(smart_page) -> None:
    page = RecordingSessionPage(smart_page).open().assert_loaded()
    assert page.find(page.LOC_BROWSER_TYPE).is_visible()
    assert page.find(page.LOC_BASE_URL).is_visible()
    assert page.find(page.LOC_FEATURE_TITLE).is_visible()
    assert page.find(page.LOC_PROJECT_NAME).is_visible()
    assert page.find(page.LOC_START_BTN).is_visible()


@pytest.mark.ui
@pytest.mark.recording_session
@pytest.mark.positive
@allure.title("Filling the intake form does not raise validation errors")
def test_fill_intake_form(smart_page) -> None:
    page = RecordingSessionPage(smart_page).open().assert_loaded()
    page.fill_intake(
        base_url="about:blank",
        feature_title="Self-test recording",
        project_name="ui-recording-suite",
        browser="chromium",
    )
    assert page.find(page.LOC_BROWSER_TYPE).input_value() == "chromium"
