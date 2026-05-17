"""
Typed REST client for ALL ZAC `/api/*` endpoints.

Layout mirrors the server router groupings:
    - health / config
    - validate / export
    - rerun / test-runner
    - recording (REST half; WS half lives in utils/ws_client.py)
    - files (steps / feature / playwright / selenium)
    - generate-step-definitions / generate-test-cases / storage
    - projects (CRUD / save / append-steps / generate-files)
    - locators (project-scoped + legacy)
    - flows / test-data
    - environments
    - maven / npm
    - requirements (parse / generate-feature / traceability)

All methods return raw `requests.Response`; pass `raise_on_status=True` if
you want the client to throw on non-2xx.

Owner: ZAC Platform QA
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import requests

from utils.logger import get_logger
from utils.retry import retry_network

log = get_logger(__name__)


@dataclass
class ApiClientConfig:
    base_url: str
    timeout: float = 10.0
    auth_mode: str = "none"
    api_key: Optional[str] = None
    bearer_token: Optional[str] = None

    @classmethod
    def from_env(cls) -> "ApiClientConfig":
        return cls(
            base_url=os.getenv("ZAC_API_BASE_URL", "http://localhost:3000/api"),
            timeout=float(os.getenv("ZAC_API_TIMEOUT", "10")),
            auth_mode=os.getenv("ZAC_AUTH_MODE", "none"),
            api_key=os.getenv("ZAC_API_KEY") or None,
            bearer_token=os.getenv("ZAC_BEARER_TOKEN") or None,
        )


class ZacApiClient:
    def __init__(self, config: Optional[ApiClientConfig] = None) -> None:
        self.config = config or ApiClientConfig.from_env()
        self._session = requests.Session()
        self._session.headers.update(self._auth_headers())

    def close(self) -> None:
        self._session.close()

    def _auth_headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.config.auth_mode == "bearer" and self.config.bearer_token:
            headers["Authorization"] = f"Bearer {self.config.bearer_token}"
        elif self.config.auth_mode == "api_key" and self.config.api_key:
            headers["X-API-Key"] = self.config.api_key
        return headers

    def _url(self, path: str) -> str:
        return f"{self.config.base_url.rstrip('/')}/{path.lstrip('/')}"

    @retry_network()
    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
        files: Optional[dict[str, Any]] = None,
        data: Optional[dict[str, Any]] = None,
        raise_on_status: bool = False,
        extra_headers: Optional[dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> requests.Response:
        url = self._url(path)
        log.info(
            "api request",
            extra={"event": "api.request", "method": method, "url": url},
        )

        # Multipart uploads cannot reuse the JSON content-type header.
        headers = None
        if files is not None:
            headers = dict(self._session.headers)
            headers.pop("Content-Type", None)
            if extra_headers:
                headers.update(extra_headers)
        elif extra_headers:
            headers = extra_headers

        resp = self._session.request(
            method=method,
            url=url,
            json=json_body if files is None else None,
            params=params,
            files=files,
            data=data,
            timeout=timeout or self.config.timeout,
            headers=headers,
        )
        log.info(
            "api response",
            extra={
                "event": "api.response",
                "method": method,
                "url": url,
                "status": resp.status_code,
                "ms": int(resp.elapsed.total_seconds() * 1000),
            },
        )
        if raise_on_status:
            resp.raise_for_status()
        return resp

    # ============================================================
    #                  Health / config / storage
    # ============================================================

    def health(self) -> requests.Response:
        return self._request("GET", "/health")

    def config(self) -> requests.Response:
        return self._request("GET", "/config")

    def storage_stats(self) -> requests.Response:
        return self._request("GET", "/storage/stats")

    # ============================================================
    #                     Step builder / validation
    # ============================================================

    def validate_steps(self, steps: list[dict]) -> requests.Response:
        return self._request("POST", "/validate", json_body={"steps": steps})

    # ============================================================
    #                            Export
    # ============================================================

    def export(self, payload: dict) -> requests.Response:
        return self._request("POST", "/export", json_body=payload, timeout=60.0)

    # ============================================================
    #                           Rerun
    # ============================================================

    def rerun(self, payload: dict) -> requests.Response:
        return self._request("POST", "/rerun", json_body=payload, timeout=120.0)

    def rerun_cancel(self, execution_id: Optional[str] = None) -> requests.Response:
        body = {"executionId": execution_id} if execution_id else {}
        return self._request("POST", "/rerun/cancel", json_body=body)

    # ============================================================
    #                         Test runner
    # ============================================================

    def test_runner_run(self, payload: dict) -> requests.Response:
        return self._request("POST", "/test-runner/run", json_body=payload, timeout=120.0)

    # ============================================================
    #                          Recording
    # ============================================================

    def recording_start(self, payload: Optional[dict] = None) -> requests.Response:
        return self._request(
            "POST", "/recording/start", json_body=payload or {}, timeout=30.0
        )

    def recording_stop(self, payload: dict) -> requests.Response:
        return self._request("POST", "/recording/stop", json_body=payload, timeout=60.0)

    def recording_status(self, session_id: str) -> requests.Response:
        return self._request("GET", f"/recording/{session_id}/status")

    def recording_actions(self, session_id: str) -> requests.Response:
        return self._request("GET", f"/recording/{session_id}/actions")

    def recording_post_action(self, session_id: str, action: dict) -> requests.Response:
        body = {"sessionId": session_id, **action}
        return self._request(
            "POST", f"/recording/{session_id}/action", json_body=body
        )

    # ============================================================
    #                          File ops
    # ============================================================

    def get_steps_file(self, project_name: str) -> requests.Response:
        return self._request("GET", f"/files/steps/{project_name}")

    def post_steps_file(self, project_name: str, content: str) -> requests.Response:
        return self._request(
            "POST", f"/files/steps/{project_name}", json_body={"content": content}
        )

    def get_feature_file(self, project_name: str) -> requests.Response:
        return self._request("GET", f"/files/feature/{project_name}")

    def post_feature_file(self, project_name: str, content: str) -> requests.Response:
        return self._request(
            "POST", f"/files/feature/{project_name}", json_body={"content": content}
        )

    def post_playwright_file(self, project_name: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/files/playwright/{project_name}", json_body=payload
        )

    def post_selenium_file(self, project_name: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/files/selenium/{project_name}", json_body=payload
        )

    def generate_step_definitions(self, payload: dict) -> requests.Response:
        return self._request("POST", "/generate-step-definitions", json_body=payload)

    def generate_test_cases(self, payload: dict) -> requests.Response:
        return self._request("POST", "/generate-test-cases", json_body=payload)

    # ============================================================
    #                          Projects
    # ============================================================

    def list_projects(self) -> requests.Response:
        return self._request("GET", "/projects")

    def get_current(self) -> requests.Response:
        return self._request("GET", "/projects/current")

    def get_project(self, project_id: str) -> requests.Response:
        return self._request("GET", f"/projects/{project_id}")

    def create_project(self, payload: dict) -> requests.Response:
        return self._request("POST", "/projects", json_body=payload)

    def select_project(self, project_id: str) -> requests.Response:
        return self._request(
            "POST", "/projects/select", json_body={"projectId": project_id}
        )

    def save_project(self, project_id: str, payload: dict) -> requests.Response:
        return self._request("POST", f"/projects/{project_id}/save", json_body=payload)

    def append_steps(self, project_id: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/projects/{project_id}/append-steps", json_body=payload
        )

    def generate_files(self, project_id: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/projects/{project_id}/generate-files", json_body=payload, timeout=60.0
        )

    def delete_project(self, project_id: str) -> requests.Response:
        return self._request("DELETE", f"/projects/{project_id}")

    # ============================================================
    #                          Locators
    # ============================================================

    def list_locators(self, project_id: str) -> requests.Response:
        return self._request("GET", f"/projects/{project_id}/locators")

    def save_locator(self, project_id: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/projects/{project_id}/locators", json_body=payload
        )

    def delete_locator(self, project_id: str, locator_id: str) -> requests.Response:
        return self._request(
            "DELETE", f"/projects/{project_id}/locators/{locator_id}"
        )

    # legacy
    def list_locators_legacy(self, project_name: str) -> requests.Response:
        return self._request("GET", f"/locators/{project_name}")

    def get_locator_by_id_legacy(
        self, project_name: str, locator_id: str
    ) -> requests.Response:
        return self._request("GET", f"/locators/{project_name}/{locator_id}")

    def get_locators_by_page_legacy(
        self, project_name: str, page_name: str
    ) -> requests.Response:
        return self._request(
            "GET", f"/locators/{project_name}/page/{page_name}"
        )

    def save_locator_legacy(
        self, project_name: str, payload: dict
    ) -> requests.Response:
        return self._request("POST", f"/locators/{project_name}", json_body=payload)

    def delete_locator_legacy(
        self, project_name: str, locator_id: str
    ) -> requests.Response:
        return self._request("DELETE", f"/locators/{project_name}/{locator_id}")

    # ============================================================
    #                            Flows
    # ============================================================

    def list_flows(self, project_id: str) -> requests.Response:
        return self._request("GET", f"/projects/{project_id}/flows")

    def save_flow(self, project_id: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/projects/{project_id}/flows", json_body=payload
        )

    def delete_flow(self, project_id: str, flow_id: str) -> requests.Response:
        return self._request("DELETE", f"/projects/{project_id}/flows/{flow_id}")

    # ============================================================
    #                          Test data
    # ============================================================

    def list_test_data(self, project_id: str) -> requests.Response:
        return self._request("GET", f"/projects/{project_id}/test-data")

    def save_test_data(self, project_id: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/projects/{project_id}/test-data", json_body=payload
        )

    # ============================================================
    #                        Environments
    # ============================================================

    def list_environments(self) -> requests.Response:
        return self._request("GET", "/environments")

    def get_environment(self, name: str) -> requests.Response:
        return self._request("GET", f"/environments/{name}")

    def save_environment(self, payload: dict) -> requests.Response:
        return self._request("POST", "/environments", json_body=payload)

    def delete_environment(self, name: str) -> requests.Response:
        return self._request("DELETE", f"/environments/{name}")

    # ============================================================
    #                            Maven
    # ============================================================

    def maven_check(self) -> requests.Response:
        return self._request("GET", "/maven/check")

    def maven_check_project(self, project_id: str) -> requests.Response:
        return self._request("GET", f"/projects/{project_id}/maven/check")

    def maven_execute(self, project_id: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/projects/{project_id}/maven/execute", json_body=payload, timeout=120.0
        )

    def maven_running(self) -> requests.Response:
        return self._request("GET", "/maven/running")

    def maven_cancel(self, execution_id: str) -> requests.Response:
        return self._request(
            "POST", "/maven/cancel", json_body={"executionId": execution_id}
        )

    # ============================================================
    #                             NPM
    # ============================================================

    def npm_check(self) -> requests.Response:
        return self._request("GET", "/npm/check")

    def npm_check_project(self, project_id: str) -> requests.Response:
        return self._request("GET", f"/projects/{project_id}/npm/check")

    def npm_execute(self, project_id: str, payload: dict) -> requests.Response:
        return self._request(
            "POST", f"/projects/{project_id}/npm/execute", json_body=payload, timeout=120.0
        )

    def npm_running(self) -> requests.Response:
        return self._request("GET", "/npm/running")

    def npm_cancel(self, execution_id: str) -> requests.Response:
        return self._request(
            "POST", "/npm/cancel", json_body={"executionId": execution_id}
        )

    # ============================================================
    #                       Requirements
    # ============================================================

    def requirements_parse(
        self,
        file_path: str | Path,
        *,
        format_: str = "text",
    ) -> requests.Response:
        path = Path(file_path)
        with path.open("rb") as fh:
            files = {"document": (path.name, fh, "text/plain")}
            return self._request(
                "POST",
                "/requirements/parse",
                files=files,
                data={"format": format_},
                timeout=30.0,
            )

    def requirements_generate_feature(self, payload: dict) -> requests.Response:
        return self._request(
            "POST", "/requirements/generate-feature", json_body=payload
        )

    def requirements_traceability(self, payload: dict) -> requests.Response:
        return self._request(
            "POST", "/requirements/traceability", json_body=payload
        )
