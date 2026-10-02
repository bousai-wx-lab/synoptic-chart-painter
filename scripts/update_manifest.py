"""Update hashes after an explicitly reviewed release change."""
import hashlib
import json
import mimetypes
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
allowlist = json.loads((root / "release-allowlist.json").read_text())
records = []
for name in sorted(allowlist["allowed_files"]):
    if name == "release-manifest.json":
        continue
    data = (root / name).read_bytes()
    records.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "mime_type": mimetypes.guess_type(name)[0] or "application/octet-stream"})
manifest = {"schema_version": 1, "tool_slug": allowlist["tool_slug"], "generated_at": datetime.now(timezone.utc).isoformat(), "files": records}
(root / "release-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(f"RELEASE_MANIFEST_UPDATED files={len(records)}")
