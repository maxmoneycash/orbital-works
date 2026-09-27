"""
build_web.py
Headless pipeline: roman_build -> geometry pass -> roman_export_web.

    npm run roman:glb
    (or)  ROMAN_OUT_DIR=public/models blender -b --factory-startup \
              --python scripts/roman/build_web.py

Parts are exported unmerged (146 meshes): the explorer picks, labels and
folds individual parts, and 146 draw calls is nothing for WebGL.

Only the geometry half of roman_materials.py runs here (smooth-by-angle
and the 2 mm edge bevel). Its shaders are procedural, and glTF drops
procedural textures, so running them would change nothing in the .glb.
RomanWindow.svelte re-authors every material by name at runtime instead.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import roman_build
import roman_materials
import roman_export_web

roman_build.BUILD_SCENE = False     # camera/lights are dropped by the export anyway
roman_export_web.MERGE = False      # the explorer picks, labels and folds single parts
roman_export_web.DRACO = True       # 3.4 MB -> well under 1 MB; decoder in public/draco
roman_build.main()
roman_materials.shade_and_bevel()
roman_export_web.main()
