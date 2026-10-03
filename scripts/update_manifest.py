"""Update hashes after an explicitly reviewed release change."""
import hashlib
import json
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
allowlist = json.loads((root / "release-allowlist.json").read_text())
# Content versions keep browsers from combining new HTML with cached old code.
html_path = root / "index.html"
html = html_path.read_text()
for asset in ("styles.css", "analysis.js", "geography.js", "catalog.js", "app.js"):
    version = hashlib.sha256((root / asset).read_bytes()).hexdigest()[:16]
    html, count = re.subn(
        rf'((?:src|href)=")({re.escape(asset)})(?:\?v=[a-f0-9]+)?(")',
        lambda match: match[1] + asset + "?v=" + version + match[3],
        html,
    )
    if count != 1:
        raise ValueError("Missing or duplicate HTML asset: " + asset)
html_path.write_text(html)
records = []
for name in sorted(allowlist["allowed_files"]):
    if name == "release-manifest.json":
        continue
    data = (root / name).read_bytes()
    records.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "mime_type": mimetypes.guess_type(name)[0] or "application/octet-stream"})
manifest = {"schema_version": 1, "tool_slug": allowlist["tool_slug"], "generated_at": datetime.now(timezone.utc).isoformat(), "files": records}
(root / "release-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(f"RELEASE_MANIFEST_UPDATED files={len(records)}")
