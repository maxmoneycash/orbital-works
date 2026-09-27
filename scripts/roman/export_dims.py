"""
export_dims.py
Write the dimension store to JSON for the web explorer.

    python3 scripts/roman/export_dims.py     (npm run roman:glb runs it)

Every number the explorer shows is read from this file, so the site can
never drift from roman_dims.py or quote a value without its provenance.
Pure Python; no Blender.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import roman_dims as D  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "src", "data", "roman-dims.json")


def main():
    D.check_budget()
    counts, _ = D.audit_provenance(verbose=False)
    dims = {}
    for name, val in sorted(vars(D).items()):
        if name.startswith("_") or not isinstance(val, (D.Dim, D.DimTuple, D.DimFlag)):
            continue
        if isinstance(val, D.DimTuple):
            value = [round(float(x), 4) for x in val]
        else:
            value = round(float(val), 4)
        dims[name] = {"value": value, "tag": val.tag, "note": val.note}
    out = {
        "_generated": "scripts/roman/export_dims.py -- do not edit by hand",
        "provenance": counts,
        "corrections": [
            {"topic": t, "text": x, "sources": s} for t, x, s in D.CORRECTIONS
        ],
        "dims": dims,
    }
    with open(os.path.normpath(OUT), "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"[dims] wrote {len(dims)} dimensions -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
