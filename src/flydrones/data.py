"""Download the MaleCNS v1.0 flat connectome (CC-BY) with resume support."""

from __future__ import annotations

import sys
import time
import urllib.request
from pathlib import Path

from .brain.connectome import MALECNS_BASE, MALECNS_FILES


def download(url: str, dest: Path, chunk: int = 1 << 20) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    have = tmp.stat().st_size if tmp.exists() else 0
    req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
    with urllib.request.urlopen(req) as r:
        total = int(r.headers.get("Content-Length", 0)) + have
        mode = "ab" if have and r.status == 206 else "wb"
        if mode == "wb":
            have = 0
        t0 = time.time()
        with open(tmp, mode) as f:
            while True:
                b = r.read(chunk)
                if not b:
                    break
                f.write(b)
                have += len(b)
                if total:
                    mb = have / 1e6
                    speed = mb / max(time.time() - t0, 1e-3)
                    sys.stdout.write(f"\r  {dest.name}: {mb:8.1f} / {total / 1e6:.1f} MB  ({speed:.1f} MB/s)")
                    sys.stdout.flush()
    tmp.replace(dest)
    sys.stdout.write("\n")
    return dest


def download_malecns(data_dir: str | Path = "data/malecns_v1", skip_existing: bool = True) -> Path:
    data_dir = Path(data_dir)
    print("MaleCNS v1.0 connectome - Janelia FlyEM, Cambridge, MRC LMB, Google Research - CC-BY 4.0")
    print("about 1.2 GB in total")
    for name in MALECNS_FILES.values():
        dest = data_dir / name
        if skip_existing and dest.exists():
            print(f"  {name}: already there")
            continue
        download(f"{MALECNS_BASE}/{name}", dest)
    return data_dir
