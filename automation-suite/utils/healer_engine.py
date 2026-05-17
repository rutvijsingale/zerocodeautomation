"""
ZAC HealerEngine - records when a fallback strategy resolved a locator and
emits a per-suite YAML report listing recommended primary-locator updates.

The engine is intentionally lightweight: it does NOT mutate test code at
runtime. Healing happens at *planning* time via the report this module writes.

Outputs:
    reports/healer/<suite>.heal.json   - raw events
    reports/healer/<suite>.suggest.md  - human-readable suggestions

Owner: ZAC Platform QA
"""

from __future__ import annotations

import json
import os
import threading
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import DefaultDict


class _HealerEngine:
    def __init__(self) -> None:
        self._enabled = os.getenv("ZAC_HEALER_ENABLED", "true").lower() == "true"
        self._dir = Path(os.getenv("ZAC_HEALER_REPORT_DIR", "reports/healer"))
        self._suite = os.getenv("ZAC_SUITE", "project_management")
        self._lock = threading.Lock()
        self._events: list[dict] = []
        self._counts: DefaultDict[str, int] = defaultdict(int)

    def record_heal(
        self,
        name: str,
        primary_strategy: str,
        healed_strategy: str,
    ) -> None:
        if not self._enabled:
            return
        with self._lock:
            self._counts[name] += 1
            self._events.append(
                {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "locator": name,
                    "primary": primary_strategy,
                    "healed_with": healed_strategy,
                }
            )

    def flush(self) -> None:
        if not self._enabled or not self._events:
            return

        self._dir.mkdir(parents=True, exist_ok=True)

        json_path = self._dir / f"{self._suite}.heal.json"
        with json_path.open("w", encoding="utf-8") as f:
            json.dump(
                {"suite": self._suite, "events": self._events}, f, indent=2
            )

        md_path = self._dir / f"{self._suite}.suggest.md"
        with md_path.open("w", encoding="utf-8") as f:
            f.write(f"# Healer suggestions - {self._suite}\n\n")
            if not self._counts:
                f.write("_No heals recorded - all primary locators stable._\n")
                return
            f.write("| Locator | Heals | Recommendation |\n")
            f.write("|---|---:|---|\n")
            for name, n in sorted(
                self._counts.items(), key=lambda kv: -kv[1]
            ):
                f.write(
                    f"| `{name}` | {n} | "
                    "Promote healed strategy to primary in the Page Object. |\n"
                )


healer = _HealerEngine()
