"""Read-only Linux capacity, release-retention and SQLite backup verification report.
Never deletes files or starts/stops services. Run as the application operator.
"""
from contextlib import closing
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess


def report(root, releases, current, keep, backups, services):
    usage = shutil.disk_usage(root)
    used = round(usage.used / usage.total * 100, 1)
    result = {"time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "disk": {"total": usage.total, "free": usage.free, "usedPercent": used,
                       "level": "critical" if used >= 90 else "warning" if used >= 80 else "ok"},
              "releases": [], "backups": [], "services": {}}
    if releases:
        folder = Path(releases).resolve(strict=True)
        active = Path(current).resolve(strict=True)
        if not active.is_dir() or active.parent != folder:
            raise ValueError("Current release must resolve to a direct child of releases")
        versions = sorted((p for p in folder.iterdir() if p.is_dir() and not p.is_symlink()),
                          key=lambda p: p.stat().st_mtime, reverse=True)
        preserved = {active, *[p for p in versions if p != active][:keep]}
        result["releases"] = [{"path": str(p), "action": "retain" if p in preserved else "review",
                               "active": p == active} for p in versions]
    for filename in backups:
        path = Path(filename).resolve(strict=True)
        # immutable read-only connections; verify consistent standalone backup copies only.
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
            checks = [r[0] for r in db.execute("PRAGMA integrity_check")]
        result["backups"].append({"path": str(path), "integrity": checks,
                                  "ok": checks == ["ok"], "bytes": path.stat().st_size})
    for service in services:
        if not service or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.@-" for c in service):
            raise ValueError("Invalid service name")
        command = subprocess.run(["systemctl", "is-active", service], capture_output=True, text=True, timeout=10)
        result["services"][service] = command.stdout.strip() or "unknown"
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disk", default="/")
    parser.add_argument("--releases")
    parser.add_argument("--current")
    parser.add_argument("--keep", type=int, default=3, help="Rollback releases in addition to current")
    parser.add_argument("--backup", action="append", default=[], help="Standalone SQLite backup copy, never a live WAL database")
    parser.add_argument("--service", action="append", default=[])
    args = parser.parse_args()
    if args.keep < 1 or bool(args.releases) != bool(args.current):
        parser.error("Keep at least one rollback release and supply releases/current together")
    data = report(args.disk, args.releases, args.current, args.keep, args.backup, args.service)
    print(json.dumps(data, ensure_ascii=False, indent=2))
    raise SystemExit(2 if data["disk"]["level"] == "critical" or any(not b["ok"] for b in data["backups"]) or any(s != "active" for s in data["services"].values()) else 1 if data["disk"]["level"] == "warning" else 0)
