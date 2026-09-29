"""Bake the orbital census into public/data/census.json.

Every object CelesTrak's catalogue (SATCAT) lists as still in Earth orbit,
with its type and the orbit it is catalogued in: perigee, apogee and
inclination. The catalogue does not say where along that orbit an object is,
or how the orbit is turned about the pole, so the globe draws those two
angles from each object's catalogue number: the height, shape and tilt of
every orbit are real, its place in the sky is not.

Debris is split by what it came from, as the catalogue's types don't say:
a piece named like a rocket body from the same launch is rocket debris, one
named like a payload from it is payload debris.

    python3 scripts/census/build_census.py

Standard library plus curl. Re-run to refresh; the catalogue updates daily.
"""
import csv, io, json, subprocess, sys, time
from collections import defaultdict, Counter
from pathlib import Path

URL = "https://celestrak.org/pub/satcat.csv"
OUT = Path(__file__).resolve().parents[2] / "public" / "data" / "census.json"

# Type codes, in the order the app shows them.
TYPES = ["payload", "payload-debris", "rocket-body", "rocket-debris", "debris", "unknown"]
WORKING = set("+PBSX")        # SATCAT operational status: working, partly, backup, spare, extended


def fetch() -> str:
    # curl trusts the system keychain, which networks that re-sign TLS rely on.
    return subprocess.run(["curl", "-sS", "--fail", "--max-time", "180", URL],
                          check=True, capture_output=True, text=True).stdout


def launch_of(object_id: str) -> str:
    return object_id[:8]      # "1999-025ABC" -> "1999-025"


# Upper stages whose pieces are named after the stage, not after the launch's
# own rocket-body entry (a Fregat on a Soyuz, say).
STAGES = ("FREGAT", "BREEZE", "CENTAUR", "AGENA", "CZ-", "SL-", "FALCON", "DELTA",
          "ATLAS", "TITAN", "ARIANE", "PSLV", "GSLV", "H-2", "H-II", "THOR", "SCOUT",
          "ELECTRON", "PEGASUS", "MINOTAUR", "VEGA", "ANTARES", "PROTON", "ZENIT",
          "SOYUZ", "IUS", "PAM-", "KUAIZHOU", "KZ-", "YUANZHENG", "NORTH STAR")


def debris_parent(name: str, launch_names: dict) -> str:
    # Released by satellites: reactor coolant (NaK) droplets, West Ford needles.
    if "COOLANT" in name or "NEEDLES" in name:
        return "payload-debris"
    base = name.split(" DEB")[0].strip()
    if not base or base == name:
        return "debris"
    rockets, payloads = launch_names["R/B"], launch_names["PAY"]
    if "R/B" in base or base.startswith(STAGES) or any(r.startswith(base) for r in rockets):
        return "rocket-debris"
    if any(p.startswith(base) or base.startswith(p.split(" (")[0]) for p in payloads):
        return "payload-debris"
    return "debris"


def main():
    rows = list(csv.DictReader(io.StringIO(fetch())))
    print(f"[census] {len(rows)} catalogue rows")
    # Every launch's payload and rocket-body names, decayed ones included:
    # debris often outlives its parent.
    names = defaultdict(lambda: {"PAY": [], "R/B": []})
    for r in rows:
        if r["OBJECT_TYPE"] in ("PAY", "R/B"):
            names[launch_of(r["OBJECT_ID"])][r["OBJECT_TYPE"]].append(r["OBJECT_NAME"])

    out = {k: [] for k in ("t", "pe", "ap", "inc", "id", "yr", "ok", "name")}
    skipped = Counter()
    for r in rows:
        if r["DECAY_DATE"] or r["ORBIT_CENTER"] != "EA" or r["ORBIT_TYPE"] != "ORB":
            skipped["not in Earth orbit"] += 1
            continue
        try:
            pe, ap, inc = float(r["PERIGEE"]), float(r["APOGEE"]), float(r["INCLINATION"])
        except ValueError:
            skipped["no orbit"] += 1
            continue
        if pe < 80 or ap < pe:
            skipped["no orbit"] += 1
            continue
        kind = r["OBJECT_TYPE"]
        if kind == "PAY":
            t = "payload"
        elif kind == "R/B":
            t = "rocket-body"
        elif kind == "DEB":
            t = debris_parent(r["OBJECT_NAME"], names[launch_of(r["OBJECT_ID"])])
        else:
            t = "unknown"
        out["t"].append(TYPES.index(t))
        out["pe"].append(round(pe))
        out["ap"].append(round(ap))
        out["inc"].append(round(inc * 100))
        out["id"].append(int(r["NORAD_CAT_ID"]))
        out["yr"].append(int(r["LAUNCH_DATE"][:4]) if r["LAUNCH_DATE"][:4].isdigit() else 0)
        out["ok"].append(1 if kind == "PAY" and r["OPS_STATUS_CODE"] in WORKING else 0)
        out["name"].append(r["OBJECT_NAME"])

    n = len(out["t"])
    by_type = Counter(TYPES[t] for t in out["t"])
    doc = {
        "source": "CelesTrak SATCAT, " + URL,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "types": TYPES,
        "count": n,
        **out,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"[census] {n} objects in orbit -> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")
    for k in TYPES:
        print(f"  {k:<15} {by_type[k]:>6}")
    print(f"  working payloads {sum(out['ok'])}")
    for k, v in skipped.items():
        print(f"  skipped: {k} {v}")


if __name__ == "__main__":
    sys.exit(main())
