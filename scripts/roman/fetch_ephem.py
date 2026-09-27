"""Bake deep-space ephemerides from JPL Horizons into public/data/deep-space.json.

Geocentric positions, ICRF equatorial frame, km — the frame the globe's
inertial satellites live in (TEME differs by well under a degree). Roman's
published predict is re-issued as the mission flies; re-run this to refresh:

    python3 scripts/roman/fetch_ephem.py

Standard library plus curl.
"""
import json, math, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
OUT = Path(__file__).resolve().parents[2] / "public" / "data" / "deep-space.json"

# name: (Horizons id, start, stop, step)
BODIES = {
    "roman":  ("-211", "2026-08-30 12:00", None, "30 m"),
    "jwst":   ("-170", "2026-08-01", "2027-12-31", "1 d"),
    "euclid": ("-680", "2026-08-01", "2027-12-31", "1 d"),
    "moon":   ("301",  "2026-08-01", "2027-12-31", "6 h"),
    "sun":    ("10",   "2026-08-01", "2027-12-31", "1 d"),
}


def query(cmd: str, start: str, stop: str, step: str) -> str:
    q = {
        "format": "text", "COMMAND": f"'{cmd}'", "OBJ_DATA": "NO", "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS", "CENTER": "'500@399'", "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step}'", "REF_PLANE": "FRAME",
        "REF_SYSTEM": "ICRF", "VEC_TABLE": "1", "CSV_FORMAT": "YES", "OUT_UNITS": "KM-S",
    }
    url = API + "?" + urllib.parse.urlencode(q)
    # curl trusts the system keychain, which networks that re-sign TLS rely on;
    # Python's own CA bundle often doesn't. Verification stays on either way.
    try:
        return subprocess.run(["curl", "-sS", "--max-time", "120", url],
                              check=True, capture_output=True, text=True).stdout
    except (OSError, subprocess.CalledProcessError):
        with urllib.request.urlopen(url, timeout=120) as r:
            return r.read().decode()


def rows(text: str):
    out, on = [], False
    for line in text.splitlines():
        if line.startswith("$$SOE"):
            on = True
        elif line.startswith("$$EOE"):
            break
        elif on:
            p = [s.strip() for s in line.split(",")]
            out.append((float(p[0]), float(p[2]), float(p[3]), float(p[4])))
    return out


def last_epoch(text: str) -> str | None:
    """Horizons says where a spacecraft's predict ends; take it as the stop."""
    marker = 'after A.D. '
    i = text.find(marker)
    if i < 0:
        return None
    # "2026-OCT-19 13:01:09.1824 TDB" -> "2026-OCT-19 13:01"
    return text[i + len(marker):].split(" TDB")[0][:17]


def main():
    data = {
        "source": "JPL Horizons (ssd.jpl.nasa.gov), geocentric vectors",
        "frame": "ICRF equatorial, geocentric, km",
        "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bodies": {},
    }
    for name, (cmd, start, stop, step) in BODIES.items():
        if stop is None:
            probe = query(cmd, start, "2030-01-01", step)
            stop = last_epoch(probe)
            if not stop:
                sys.exit(f"{name}: could not find the end of the published predict")
        r = rows(query(cmd, start, stop, step))
        if len(r) < 2:
            sys.exit(f"{name}: no rows")
        jd0 = r[0][0]
        dt = (r[1][0] - jd0) * 86400.0
        data["bodies"][name] = {
            "horizons": cmd,
            "t0": round((jd0 - 2440587.5) * 86400000),  # Unix ms (TDB, ~69 s from UTC: ignored)
            "step": round(dt),
            "n": len(r),
            "xyz": [round(v) for row in r for v in row[1:]],
        }
        far = max(math.sqrt(x * x + y * y + z * z) for _, x, y, z in r)
        print(f"{name:7s} {len(r):5d} rows  {start} -> {stop}  max {far:,.0f} km")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
