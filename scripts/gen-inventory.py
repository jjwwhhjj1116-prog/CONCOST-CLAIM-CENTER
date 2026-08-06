import hashlib
import json
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = REPO_ROOT / "docs" / "보고서 템플릿"
OUTPUT_PATH = REPO_ROOT / "docs" / "templates" / "reference-inventory.json"
ALLOWED_EXTENSIONS = {".hwp", ".hwpx", ".pdf", ".xlsx"}


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_inventory() -> list[dict[str, object]]:
    if not SOURCE_ROOT.is_dir():
        raise FileNotFoundError(f"Reference source directory not found: {SOURCE_ROOT}")

    source_files = sorted(
        (item for item in SOURCE_ROOT.rglob("*") if item.is_file() and item.suffix.lower() in ALLOWED_EXTENSIONS),
        key=lambda item: item.relative_to(SOURCE_ROOT).as_posix(),
    )
    if len(source_files) != 32:
        raise RuntimeError(f"Expected exactly 32 reference files, found {len(source_files)}")

    inventory: list[dict[str, object]] = []
    for index, full_path in enumerate(source_files, start=1):
        source_relative = full_path.relative_to(SOURCE_ROOT)
        if len(source_relative.parts) != 2:
            raise RuntimeError(f"Unexpected reference directory depth: {source_relative}")

        file_id = f"TPL-REF-{index:03d}"
        extension = full_path.suffix.lower()
        safe_filename = f"{file_id}_template_ref{extension}"
        safe_relative_path = (Path("docs") / "보고서 템플릿" / source_relative.parts[0] / safe_filename).as_posix()
        stat = full_path.stat()
        inventory.append(
            {
                "fileId": file_id,
                "relativePath": safe_relative_path,
                "filename": safe_filename,
                "extension": extension,
                "sizeBytes": stat.st_size,
                "modifiedTime": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(),
                "sha256": sha256_file(full_path),
                "scanStatus": "UNSCANNED" if extension == ".hwp" else "REVIEW_REQUIRED",
            }
        )
    return inventory


if __name__ == "__main__":
    files = build_inventory()
    payload = {
        "totalFiles": len(files),
        "scannedAt": datetime.now().astimezone().isoformat(),
        "files": files,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved anonymized reference inventory with {len(files)} files")
