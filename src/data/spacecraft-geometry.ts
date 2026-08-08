/**
 * Procedural spacecraft geometry. Every satellite's 3D model is generated from
 * its parts list, which is what lets the anatomy view explode into labelled
 * subsystems and lets the workbench rebuild a vehicle from mixed components.
 *
 * Orbital Works spacecraft dataset.
 */
import * as THREE from 'three';
import type { Part } from './spacecraft';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { solarCellMap, foilNormalMap, hullDetailMaps } from '../scene/spacecraft-render';

/**
 * Nothing in the physical world has a perfectly sharp 90-degree edge. A true
 * sharp edge catches no light at all, which is the single loudest tell of
 * amateur 3D — the eye reads it as "computer graphics" before it reads anything
 * else. Every box on a spacecraft is a machined panel with a broken edge, and a
 * bevel that only needs to be a millimetre wide is enough to catch a highlight
 * and sell the whole surface.
 */
function roundedBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const min = Math.min(w, h, d);
  // Radius has to stay under half the smallest dimension or the geometry
  // degenerates; thin panels get a proportionally finer bevel.
  const r = Math.max(0.002, Math.min(min * 0.16, 0.035));
  return new RoundedBoxGeometry(w, h, d, 2, r);
}

/**
 * Greebles: the small hardware that covers a real bus — connector blocks, cable
 * clamps, bolt heads, bracket feet. Individually meaningless, collectively the
 * difference between a prop and a machine. Deterministic from a seed so a given
 * spacecraft looks the same on every render rather than shimmering between loads.
 */
function addGreebles(group: THREE.Group, w: number, d: number, y: number, seed: number, count = 14) {
  const rnd = (i: number) => {
    const n = Math.sin(seed * 37.1 + i * 91.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const bolt = mkMat('dark');
  const brack = mkMat('shell');
  for (let i = 0; i < count; i++) {
    const kind = rnd(i * 3) > 0.62;
    const sx = 0.02 + rnd(i * 3 + 1) * 0.05;
    const sz = 0.02 + rnd(i * 3 + 2) * 0.05;
    const sy = 0.008 + rnd(i * 5) * 0.022;
    const m = kind
      ? new THREE.Mesh(new THREE.CylinderGeometry(sx * 0.5, sx * 0.5, sy, 8), bolt)
      : new THREE.Mesh(roundedBox(sx, sy, sz), brack);
    m.position.set(
      (rnd(i * 7) - 0.5) * w * 0.82,
      y + sy / 2,
      (rnd(i * 11) - 0.5) * d * 0.82,
    );
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

/* -------------------------------------------------------------- GEOMETRY -- */

/**
 * Real spacecraft surfaces. Metalness is close to binary in reality — a surface
 * is either a conductor or it is not — so the previous mid-range values (0.3,
 * 0.5) described materials that do not exist and rendered as muddy plastic.
 * Each entry below is a real finish you would find on a satellite.
 */
const MATS: Record<string, any> = {
  // Machined and anodised aluminium structure.
  shell:  { color: 0x9aa3ac, rough: 0.42, metal: 1.0, env: 1.0, hull: true },
  // Black anodised / radiator faces. Dielectric coating, so not metal.
  dark:   { color: 0x14171b, rough: 0.55, metal: 0.15, env: 0.7, hull: true },
  // Photovoltaic cells under coverglass: dark, and glassy rather than matte.
  // White base: three.js multiplies `color` by `map`, so tinting a surface that
  // already carries a colour texture darkens it twice. The cell map defines the
  // colour; the material must not fight it.
  solar:  { color: 0xffffff, rough: 0.22, metal: 0.30, env: 1.1, map: 'solar' },
  // Multi-layer insulation. Kapton over aluminium — a true metal, and crinkled.
  gold:   { color: 0xffc46b, rough: 0.30, metal: 1.0, env: 1.5, normal: 'foil' },
  // Bare copper waveguide and feed hardware.
  copper: { color: 0xc9743a, rough: 0.34, metal: 1.0, env: 1.2 },
  // White thermal-control paint. Dielectric, fairly rough, bright.
  white:  { color: 0xe6ebef, rough: 0.62, metal: 0.04, env: 0.55, hull: true },
};

function mkMat(key: string) {
  const m = MATS[key] || MATS.shell;
  const mat = new THREE.MeshStandardMaterial({
    color: m.color,
    roughness: m.rough,
    metalness: m.metal,
    // How strongly this surface picks up the space environment. Metals live or
    // die by this; painted surfaces need it dialled back or they look wet.
    envMapIntensity: m.env ?? 1.0,
  });
  if (m.map === 'solar') {
    mat.map = solarCellMap();
    mat.map.repeat.set(2, 1);
  }
  if (m.hull) {
    const { normal, roughness } = hullDetailMaps();
    mat.normalMap = normal;
    mat.normalScale = new THREE.Vector2(0.5, 0.5);
    mat.roughnessMap = roughness;
  }
  if (m.normal === 'foil') {
    mat.normalMap = foilNormalMap();
    mat.normalMap.repeat.set(3, 3);
    mat.normalScale = new THREE.Vector2(0.65, 0.65);
  }
  return mat;
}

function addEdges(group: THREE.Group, mesh: THREE.Mesh, color = 0x6d8fa6) {
  const eg = new THREE.EdgesGeometry(mesh.geometry, 25);
  const ln = new THREE.LineSegments(
    eg,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 })
  );
  ln.position.copy(mesh.position);
  ln.rotation.copy(mesh.rotation);
  ln.userData.isEdge = true;
  group.add(ln);
}

export function buildPart(part: Part, busGeom: any): THREE.Group {
  const g = new THREE.Group();
  // Shadows are applied to the finished group rather than at each construction
  // site, so every primitive gets them without fifteen separate edits.
  const withShadows = (grp: THREE.Group) => {
    grp.traverse((o: any) => {
      if (o.isMesh && !o.userData.plume) { o.castShadow = true; o.receiveShadow = true; }
    });
    return grp;
  };
  const gm = part.geom || {};
  const bw = busGeom.w || 2.8,
    bd = busGeom.d || 1.9,
    bt = busGeom.t || busGeom.h || 0.2;

  const box = (w: number, h: number, d: number, mat: string) => {
    const m = new THREE.Mesh(roundedBox(w, h, d), mkMat(mat));
    return m;
  };

  switch (gm.kind) {
    case "plate": {
      const m = box(gm.w, gm.t, gm.d, gm.mat);
      g.add(m);
      addEdges(g, m);

      /**
       * Real buses are wrapped in multi-layer insulation, and the wrap is
       * quilted — held down on a grid so it puffs between the seams. Modelling
       * it as slightly proud tiles with gaps gives the silhouette the broken,
       * soft-edged look that photographs of actual spacecraft have, instead of
       * one smooth slab.
       */
      const cols = Math.max(2, Math.round(gm.w / 0.6));
      const rows = Math.max(2, Math.round(gm.d / 0.6));
      const cw = (gm.w * 0.98) / cols, cd = (gm.d * 0.98) / rows;
      const quiltMat = mkMat("gold");
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const q = new THREE.Mesh(roundedBox(cw * 0.9, gm.t * 0.34, cd * 0.9), quiltMat);
          q.position.set(
            -gm.w / 2 + cw * (c + 0.5),
            gm.t * 0.55,
            -gm.d / 2 + cd * (r + 0.5),
          );
          q.castShadow = true; q.receiveShadow = true;
          g.add(q);
        }
      }

      // Stiffening ribs on the underside, where the launch loads actually go.
      for (let i = -1; i <= 1; i++) {
        const rib = box(gm.w * 0.96, gm.t * 0.3, 0.05, "shell");
        rib.position.set(0, -gm.t * 0.55, (i * gm.d) / 3.4);
        g.add(rib);
      }
      addGreebles(g, gm.w, gm.d, gm.t * 0.7, gm.w * 100 + gm.d, 18);
      break;
    }
    case "box": {
      const m = box(gm.w, gm.h, gm.d, gm.mat);
      g.add(m);
      addEdges(g, m);
      break;
    }
    case "wing": {
      const sides = gm.sides || 1;
      const segL = gm.len / gm.panels;
      const solarMat = mkMat("solar");
      const frameMat = mkMat("shell");
      const backMat = mkMat("dark");

      for (let s = 0; s < sides; s++) {
        const sign = s === 0 ? 1 : -1;

        // Yoke: the arm carrying the array clear of the bus, on a drive.
        const boom = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.045, 0.42, 12),
          frameMat,
        );
        boom.rotation.z = Math.PI / 2;
        boom.position.set(sign * (bw / 2 + 0.21), 0, 0);
        boom.castShadow = true;
        g.add(boom);

        // Solar array drive — the motor the wing rotates on to track the sun.
        const drive = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.11, 14), backMat);
        drive.rotation.z = Math.PI / 2;
        drive.position.set(sign * (bw / 2 + 0.05), 0, 0);
        drive.castShadow = true;
        g.add(drive);

        for (let i = 0; i < gm.panels; i++) {
          // Panels are discrete rigid substrates with a real gap and a hinge
          // between them — a continuous strip is the giveaway that an array
          // was modelled rather than observed.
          const pw = segL * 0.88;
          const x = sign * (bw / 2 + 0.42 + segL * i + segL * 0.5);

          const cells = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.012, gm.wid * 0.94), solarMat);
          cells.position.set(x, 0.012, 0);
          cells.castShadow = true; cells.receiveShadow = true;
          g.add(cells);

          // Substrate behind the cells, and the frame around them.
          const sub = new THREE.Mesh(roundedBox(pw, 0.014, gm.wid), backMat);
          sub.position.set(x, 0, 0);
          sub.castShadow = true; sub.receiveShadow = true;
          g.add(sub);

          for (const e of [-1, 1]) {
            const rail = new THREE.Mesh(roundedBox(pw, 0.02, 0.022), frameMat);
            rail.position.set(x, 0.004, e * (gm.wid / 2 - 0.011));
            rail.castShadow = true;
            g.add(rail);
          }

          // Hinge between this panel and the next.
          if (i < gm.panels - 1) {
            const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, gm.wid * 0.8, 8), frameMat);
            hinge.rotation.x = Math.PI / 2;
            hinge.position.set(x + sign * segL * 0.5, 0, 0);
            hinge.castShadow = true;
            g.add(hinge);
          }
          addEdges(g, cells, 0x3f6ea8);
        }
      }
      break;
    }
    case "panel": {
      const m = box(gm.w, 0.03, gm.d, gm.mat);
      g.add(m);
      addEdges(g, m);
      break;
    }
    case "tiles": {
      const frame = box(gm.w, 0.05, gm.d, "dark");
      g.add(frame);
      addEdges(g, frame);
      const tw = (gm.w / gm.cols) * 0.86;
      const td = (gm.d / gm.rows) * 0.86;
      const th = gm.thin ? 0.012 : 0.03;
      for (let r = 0; r < gm.rows; r++)
        for (let c = 0; c < gm.cols; c++) {
          const t = new THREE.Mesh(
            new THREE.BoxGeometry(tw, th, td),
            mkMat("copper")
          );
          t.position.set(
            -gm.w / 2 + (gm.w / gm.cols) * (c + 0.5),
            -0.04,
            -gm.d / 2 + (gm.d / gm.rows) * (r + 0.5)
          );
          g.add(t);
        }
      break;
    }
    case "dish": {
      for (let i = 0; i < (gm.count || 1); i++) {
        const d = new THREE.Mesh(
          new THREE.SphereGeometry(
            gm.r,
            18,
            10,
            0,
            Math.PI * 2,
            0,
            Math.PI / 3.1
          ),
          mkMat("white")
        );
        d.rotation.x = Math.PI;
        const spread = (gm.count - 1) * 0.55;
        d.position.set(-spread / 2 + i * 0.55, 0, 0);
        g.add(d);
        // Feed horn suspended on a tripod over the dish — the detail that makes
        // a reflector read as an antenna rather than as a bowl.
        const feed = new THREE.Mesh(
          new THREE.ConeGeometry(gm.r * 0.15, gm.r * 0.3, 12, 1, true),
          mkMat("copper"),
        );
        feed.position.set(d.position.x, gm.r * 0.62, 0);
        feed.rotation.x = Math.PI;
        feed.castShadow = true;
        g.add(feed);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          const strut = new THREE.Mesh(
            new THREE.CylinderGeometry(0.008, 0.008, gm.r * 0.78, 6),
            mkMat("white"),
          );
          strut.position.set(
            d.position.x + Math.cos(a) * gm.r * 0.34,
            gm.r * 0.34,
            Math.sin(a) * gm.r * 0.34,
          );
          strut.rotation.z = Math.cos(a) * 0.42;
          strut.rotation.x = -Math.sin(a) * 0.42;
          strut.castShadow = true;
          g.add(strut);
        }
      }
      break;
    }
    case "cylinder": {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(gm.r, gm.r, gm.h, 20),
        mkMat(gm.mat)
      );
      g.add(m);
      break;
    }
    case "thruster": {
      const spread = ((gm.count || 1) - 1) * gm.r * 2.6;
      for (let i = 0; i < (gm.count || 1); i++) {
        const x = -spread / 2 + i * gm.r * 2.6;
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(gm.r * 0.75, gm.r, gm.h, 16),
          mkMat("dark")
        );
        body.rotation.x = Math.PI / 2;
        body.position.set(x, 0, 0);
        g.add(body);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(gm.r * 0.72, gm.r * 0.16, 8, 20),
          mkMat("copper")
        );
        ring.position.set(x, 0, -gm.h / 2);
        g.add(ring);
        if (gm.plume !== false) {
          const plume = new THREE.Mesh(
            new THREE.ConeGeometry(gm.r * 0.9, gm.h * 5, 16, 1, true),
            new THREE.MeshBasicMaterial({
              color: 0x8b7bff,
              transparent: true,
              opacity: 0.16,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          );
          plume.rotation.x = -Math.PI / 2;
          plume.position.set(x, 0, -gm.h * 2.8);
          plume.userData.plume = true;
          g.add(plume);
        }
      }
      break;
    }
    case "wheels": {
      for (let i = 0; i < gm.count; i++) {
        const w = new THREE.Mesh(
          new THREE.CylinderGeometry(gm.r, gm.r, gm.h, 20),
          mkMat("dark")
        );
        const a = (i / gm.count) * Math.PI * 2;
        w.position.set(Math.cos(a) * gm.r * 2.1, 0, Math.sin(a) * gm.r * 2.1);
        if (i % 2) w.rotation.z = Math.PI / 2;
        g.add(w);
        addEdges(g, w, 0x8aa6ba);
      }
      break;
    }
    case "tracker": {
      for (let i = 0; i < gm.count; i++) {
        const baffle = new THREE.Mesh(
          new THREE.CylinderGeometry(gm.r, gm.r * 1.25, gm.h, 14, 1, true),
          mkMat("dark")
        );
        baffle.rotation.x = -Math.PI / 2.6;
        baffle.position.set(i * 0.3 - (gm.count - 1) * 0.15, gm.h / 2, 0);
        g.add(baffle);
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(gm.r * 2.2, gm.r * 1.8, gm.r * 2.2),
          mkMat("white")
        );
        body.position.set(baffle.position.x, 0, 0.06);
        g.add(body);
      }
      break;
    }
    case "laser": {
      const R = Math.max(bw, bd) * 0.36;
      for (let i = 0; i < gm.count; i++) {
        const a = (i / gm.count) * Math.PI * 2 + 0.3;
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(gm.r, 16, 12),
          mkMat("dark")
        );
        head.position.set(Math.cos(a) * R, gm.r * 0.9, Math.sin(a) * R);
        g.add(head);
        const lens = new THREE.Mesh(
          new THREE.CircleGeometry(gm.r * 0.6, 16),
          new THREE.MeshBasicMaterial({ color: 0xe5614c })
        );
        lens.position.copy(head.position);
        lens.position.y += gm.r * 0.98;
        lens.rotation.x = -Math.PI / 2;
        g.add(lens);
        const mount = new THREE.Mesh(
          new THREE.CylinderGeometry(gm.r * 0.7, gm.r * 0.8, gm.r * 0.9, 12),
          mkMat("white")
        );
        mount.position.set(head.position.x, 0, head.position.z);
        g.add(mount);
      }
      break;
    }
    /**
     * Telescope. This is the payload on every imaging mission, so it does most
     * of the work of making an observation satellite look like one. A bare tube
     * does not: a real instrument has a stray-light baffle with internal vanes,
     * a secondary mirror held on a spider, and a mirror you can actually see
     * down the barrel.
     */
    case "telescope": {
      const r = gm.r, len = gm.len;
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 0.8, len, 24, 1, true),
        mkMat("gold"),
      );
      tube.material.side = THREE.DoubleSide;
      tube.castShadow = true;
      g.add(tube);

      // Stray-light baffle, and the vanes inside it that kill glancing light.
      const baffle = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.06, r * 1.02, len * 0.34, 24, 1, true),
        mkMat("dark"),
      );
      baffle.material.side = THREE.DoubleSide;
      baffle.position.y = -len * 0.5 - len * 0.14;
      baffle.castShadow = true;
      g.add(baffle);
      for (let v = 0; v < 3; v++) {
        const vane = new THREE.Mesh(
          new THREE.RingGeometry(r * 0.72, r * 1.0, 22),
          mkMat("dark"),
        );
        vane.rotation.x = Math.PI / 2;
        vane.position.y = -len * 0.5 - len * 0.05 - v * len * 0.09;
        g.add(vane);
      }

      // Primary mirror at the bottom of the barrel.
      const primary = new THREE.Mesh(
        new THREE.CircleGeometry(r * 0.92, 24),
        new THREE.MeshStandardMaterial({
          color: 0x9fb6c6, roughness: 0.05, metalness: 1.0, envMapIntensity: 1.6,
        }),
      );
      primary.rotation.x = -Math.PI / 2;
      primary.position.y = len * 0.45;
      g.add(primary);

      // Secondary on a four-arm spider, obscuring the centre as it really does.
      const secondary = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.26, r * 0.26, r * 0.1, 16),
        mkMat("dark"),
      );
      secondary.position.y = -len * 0.28;
      secondary.castShadow = true;
      g.add(secondary);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, 0.006, 0.012), mkMat("white"));
        arm.position.set(Math.cos(a) * r * 0.45, -len * 0.28, Math.sin(a) * r * 0.45);
        arm.rotation.y = a;
        g.add(arm);
      }
      addEdges(g, tube, 0xd9a145);
      break;
    }
    case "patch": {
      const m = box(gm.w, 0.03, gm.d, gm.mat);
      g.add(m);
      addEdges(g, m);
      break;
    }
    case "whip": {
      const w = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, gm.len, 6),
        mkMat("white")
      );
      w.position.y = gm.len / 2;
      g.add(w);
      break;
    }
    case "blanket": {
      const bc =
        gm.mat === "dark" ? 0x141a20 : gm.mat === "white" ? 0xaebecb : 0xd9a145;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 1.04, bt * 1.6, bd * 1.04),
        new THREE.MeshStandardMaterial({
          color: bc,
          roughness: 0.35,
          metalness: 0.9,
          transparent: true,
          opacity: 0.32,
        })
      );
      g.add(m);
      break;
    }
    /**
     * Propellant tank. Spherical or capsule-shaped pressure vessels are among
     * the most recognisable objects on a spacecraft, and nothing in the old
     * primitive set could produce one — every propulsion system had to be drawn
     * as a box.
     */
    case "tank": {
      const r = gm.r || 0.28;
      const len = gm.h || 0;
      const mat = mkMat(gm.mat || "white");
      const body = len > 0.02
        ? new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 20), mat)
        : new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat);
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      // Girth band and mounting lugs — a bare sphere reads as a ball.
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, r * 0.055, 8, 28), mkMat("shell"));
      band.rotation.x = Math.PI / 2;
      band.castShadow = true;
      g.add(band);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const lug = new THREE.Mesh(roundedBox(r * 0.22, r * 0.5, r * 0.16), mkMat("shell"));
        lug.position.set(Math.cos(a) * r * 1.02, -r * 0.62, Math.sin(a) * r * 1.02);
        lug.castShadow = true;
        g.add(lug);
      }
      break;
    }

    /**
     * Deployable boom or truss. SAR antennas, magnetometers and gravity-gradient
     * masts all ride on open lattice, and lattice is visually unmistakable —
     * it is the one structure that reads as "space hardware" at any distance.
     */
    case "boom": {
      const len = gm.len || 3;
      const bays = Math.max(3, Math.round(len / 0.45));
      const w = gm.r || 0.11;
      const strut = mkMat("white");
      const bayLen = len / bays;
      for (let b = 0; b < bays; b++) {
        const x = w * 0 + bayLen * (b + 0.5);
        // Three longerons plus diagonal bracing per bay.
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          const lon = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, bayLen, 6), strut);
          lon.rotation.z = Math.PI / 2;
          lon.position.set(x, Math.cos(a) * w, Math.sin(a) * w);
          lon.castShadow = true;
          g.add(lon);

          const nextA = ((k + 1) / 3) * Math.PI * 2;
          const diag = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, bayLen * 1.35, 5), strut);
          diag.position.set(
            x, (Math.cos(a) + Math.cos(nextA)) * w * 0.5, (Math.sin(a) + Math.sin(nextA)) * w * 0.5,
          );
          diag.rotation.z = Math.PI / 2.6;
          diag.rotation.y = a;
          diag.castShadow = true;
          g.add(diag);
        }
        // Ring frame at each bay joint.
        const ring = new THREE.Mesh(new THREE.TorusGeometry(w, 0.009, 6, 14), strut);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(x + bayLen / 2, 0, 0);
        g.add(ring);
      }
      break;
    }

    /**
     * Radiator panel. Heat rejection is a large fraction of a real spacecraft's
     * surface area, and radiators are recognisable by the heat pipes running
     * across an otherwise plain white face.
     */
    case "radiator": {
      const w = gm.w || 1.2, d = gm.d || 0.8;
      const face = new THREE.Mesh(roundedBox(w, 0.022, d), mkMat("white"));
      face.castShadow = true; face.receiveShadow = true;
      g.add(face);
      const pipes = Math.max(3, Math.round(w / 0.14));
      for (let i = 0; i < pipes; i++) {
        const pipe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.011, 0.011, d * 0.94, 8),
          mkMat("shell"),
        );
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(-w / 2 + (w / pipes) * (i + 0.5), 0.017, 0);
        pipe.castShadow = true;
        g.add(pipe);
      }
      // Dark backing — the anti-sun face of a radiator is not white.
      const back = new THREE.Mesh(roundedBox(w * 0.98, 0.01, d * 0.98), mkMat("dark"));
      back.position.y = -0.016;
      g.add(back);
      break;
    }

    /** Horn antenna — the flared feed used across comms and telemetry. */
    case "horn": {
      const r = gm.r || 0.16, len = gm.len || 0.42;
      const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 0.34, len, 18, 1, true),
        mkMat("copper"),
      );
      flare.material.side = THREE.DoubleSide;
      flare.castShadow = true;
      g.add(flare);
      const throat = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.34, r * 0.34, len * 0.3, 14),
        mkMat("shell"),
      );
      throat.position.y = -len * 0.62;
      throat.castShadow = true;
      g.add(throat);
      break;
    }

    default: {
      const m = box(0.3, 0.1, 0.3, "shell");
      g.add(m);
    }
  }
  return withShadows(g);
}

export const DIRS: Record<string, number[]> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  fore: [0, 0, 1],
  aft: [0, 0, -1],
  none: [0, 0, 0],
};

/* lay the parts out on the bus and record where each one flies to */
export function assemble(parts: Part[]) {
  const bus = parts.find((p) => p.cat === "STRUCTURE");
  const bg = bus ? bus.geom : { w: 2.8, d: 1.9, t: 0.2 };
  const bt = bg.t || bg.h || 0.2;
  const placed: { part: Part; pos: THREE.Vector3; dir: number[]; rank: number }[] = [];
  let yDown = -bt / 2,
    yUp = bt / 2,
    zAft = -(bg.d || 1) / 2,
    rank: Record<string, number> = { up: 0, down: 0, fore: 0, aft: 0, none: 0 };

  for (const p of parts) {
    const gm = p.geom || {};
    let pos = new THREE.Vector3(0, 0, 0);
    const dirKey = p.dir || "none";
    if (p.slot === "nadir") {
      const h = gm.kind === "telescope" ? gm.len : gm.kind === "dish" ? gm.r : 0.1;
      yDown -= h / 2 + 0.04;
      pos.set(0, yDown, 0);
      yDown -= h / 2;
    } else if (p.slot === "zenith") {
      const h = gm.kind === "whip" ? 0.06 : gm.h || gm.r || 0.12;
      yUp += h / 2 + 0.04;
      // Zenith parts tile in a 3-wide grid across the bus deck. The spacing
      // has to scale with the bus: a fixed 0.5 m step spreads a 6U cubesat's
      // avionics half a metre apart on a vehicle barely wider than that, so
      // the spacecraft reads as loose debris. Clamping keeps large buses at
      // their existing layout while small ones tighten onto the deck.
      const sx = Math.min(0.5, (bg.w || 2.8) / 3.2);
      const sz = Math.min(0.45, (bg.d || 1.9) / 3.2);
      pos.set(
        (rank.up % 3) * sx - sx,
        yUp,
        Math.floor(rank.up / 3) * sz - sz * 0.66
      );
      yUp = Math.max(yUp, bt / 2);
    } else if (p.slot === "aft") {
      pos.set(0, 0, zAft - (gm.h || 0.2) / 2 - 0.03);
    }
    placed.push({
      part: p,
      pos,
      dir: DIRS[dirKey] || DIRS.none,
      rank: rank[dirKey] !== undefined ? rank[dirKey]++ : 0,
    });
  }
  return { placed, bg };
}

