#!/usr/bin/env python3
"""Package only Thunderbird Plus runtime files into its local XPI."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


WORKSPACE = Path(__file__).resolve().parent.parent
SOURCE = WORKSPACE / "thunderbird-interaction-enhancer"
TARGET = WORKSPACE / "thunderbird-interaction-enhancer.xpi"
EXCLUDED_PATHS = {
    "icons/create_icon.py",
    "icons/manifest-icons-example.json",
}
EXCLUDED_DIRECTORIES = {"icons/source"}


def is_runtime_file(path: Path) -> bool:
    relative = path.relative_to(SOURCE).as_posix()
    if path.is_symlink():
        raise RuntimeError(f"refusing to package symlink: {relative}")
    if path.suffix.lower() == ".md" or path.name == ".DS_Store":
        return False
    if relative in EXCLUDED_PATHS:
        return False
    return not any(relative.startswith(f"{directory}/") for directory in EXCLUDED_DIRECTORIES)


def main() -> None:
    files = sorted(path for path in SOURCE.rglob("*") if path.is_file() and is_runtime_file(path))
    descriptor, temporary_name = tempfile.mkstemp(prefix=".thunderbird-plus-", suffix=".xpi", dir=WORKSPACE)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
            for path in files:
                archive.write(path, path.relative_to(SOURCE).as_posix())

        with ZipFile(temporary) as archive:
            damaged_file = archive.testzip()
            if damaged_file:
                raise RuntimeError(f"invalid XPI member: {damaged_file}")
            names = archive.namelist()
            manifest = json.loads(archive.read("manifest.json"))
            if not manifest.get("version"):
                raise RuntimeError("extension manifest does not declare a version")
            if any(name.lower().endswith(".md") for name in names):
                raise RuntimeError("refusing to include Markdown notes in the XPI")

        temporary.chmod(0o644)
        os.replace(temporary, TARGET)
        print(f"Packaged Thunderbird Plus {manifest['version']} ({len(files)} files): {TARGET}")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
