import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = REPO_ROOT / "docs" / "templates" / "reference-inventory.json"
ALLOWED_FOLDERS = {
    "01. 감정보완 신청서",
    "02. 항소에 대한 의견 보고서",
    "03. 설계변경+물가변동+간접비",
    "04. 하자검토 보고서",
    "05. 설계변경+물가변동",
    "06. 공사비 적정성 검토 보고서",
    "07. 하자조사 보고서",
    "08. 돌관공사비",
    "09. 기시공+미시공",
}

data = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))

for item in data["files"]:
    path_parts = item["relativePath"].split("/")
    if len(path_parts) != 4 or path_parts[0:2] != ["docs", "보고서 템플릿"]:
        raise ValueError(f"Unexpected inventory path shape for {item['fileId']}")
    folder_part = path_parts[2]
    if folder_part not in ALLOWED_FOLDERS:
        raise ValueError(f"Unknown or sensitive folder metadata for {item['fileId']}")

    ext = item["extension"]
    file_id = item["fileId"]
    safe_filename = f"{file_id}_template_ref{ext}"
    safe_rel_path = f"docs/보고서 템플릿/{folder_part}/{safe_filename}"
    item["filename"] = safe_filename
    item["relativePath"] = safe_rel_path

INVENTORY_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("Anonymized reference inventory metadata successfully")
