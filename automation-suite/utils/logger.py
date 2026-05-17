"""
Structured JSON logger for the ZAC automation suite.

Every step / assertion / API call should go through `get_logger(...)` so that
CI log scrapers, Allure attachments and the HealerEngine can all consume the
same machine-readable event stream.

Owner: ZAC Platform QA
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

from pythonjsonlogger import jsonlogger

_INITIALISED = False


def _init_root() -> None:
    global _INITIALISED
    if _INITIALISED:
        return

    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        fmt=(
            "%(asctime)s %(levelname)s %(name)s "
            "%(message)s %(filename)s %(lineno)d"
        ),
        rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.getenv("ZAC_LOG_LEVEL", "INFO").upper())

    _INITIALISED = True


def get_logger(name: str) -> logging.LoggerAdapter:
    """Return a structured JSON logger bound to a stable suite identifier."""
    _init_root()
    base = logging.getLogger(name)
    return logging.LoggerAdapter(
        base,
        extra={
            "suite": "zac.project_management",
            "env": os.getenv("ZAC_ENV", "dev"),
        },
    )


def log_step(logger: logging.LoggerAdapter, step: str, **fields: Any) -> None:
    """Emit a single structured 'step' event."""
    logger.info(step, extra={"event": "step", **fields})
