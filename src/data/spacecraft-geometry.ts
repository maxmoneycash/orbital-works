/**
 * Procedural spacecraft geometry. Every satellite's 3D model is generated from
 * its parts list, which is what lets the anatomy view explode into labelled
 * subsystems and lets the workbench rebuild a vehicle from mixed components.
 *
 * Ported into satvisor from Orbital Works.
 */
import * as THREE from 'three';
import type { Part } from './spacecraft';

/* -------------------------------------------------------------- GEOMETRY -- */

const MATS: Record<string, any> = {
  shell: { color: 0x35485a, rough: 0.7, metal: 0.3 },
  dark: { color: 0x1c2833, rough: 0.85, metal: 0.2 },
  solar: { color: 0x14305c, rough: 0.35, metal: 0.5, emissive: 0x0a1830 },
  gold: { color: 0xd9a145, rough: 0.45, metal: 0.85 },
  copper: { color: 0xb5723c, rough: 0.5, metal: 0.8 },
  white: { color: 0xb9c9d6, rough: 0.8, metal: 0.1 },
};

function mkMat(key: string) {
  const m = MATS[key] || MATS.shell;
  return new THREE.MeshStandardMaterial({
    color: m.color,
    roughness: m.rough,
    metalness: m.metal,
    emissive: m.emissive || 0x000000,
  });
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
  const gm = part.geom || {};
  const bw = busGeom.w || 2.8,
    bd = busGeom.d || 1.9,
    bt = busGeom.t || busGeom.h || 0.2;

  const box = (w: number, h: number, d: number, mat: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mkMat(mat));
    return m;
  };

  switch (gm.kind) {
    case "plate": {
      const m = box(gm.w, gm.t, gm.d, gm.mat);
      g.add(m);
      addEdges(g, m);
      // stiffening ribs, purely to read as hardware
      for (let i = -1; i <= 1; i++) {
        const r = box(gm.w * 0.96, gm.t * 0.25, 0.04, "dark");
        r.position.set(0, gm.t * 0.55, (i * gm.d) / 3.4);
        g.add(r);
      }
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
      for (let s = 0; s < sides; s++) {
        const sign = s === 0 ? 1 : -1;
        const boom = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, gm.len, 8),
          mkMat("white")
        );
        boom.rotation.z = Math.PI / 2;
        boom.position.set(sign * (bw / 2 + gm.len / 2), 0, 0);
        g.add(boom);
        for (let i = 0; i < gm.panels; i++) {
          const p = new THREE.Mesh(
            new THREE.BoxGeometry(segL * 0.94, 0.02, gm.wid),
            mkMat("solar")
          );
          p.position.set(
            sign * (bw / 2 + segL * (i + 0.5)),
            0,
            0
          );
          g.add(p);
          addEdges(g, p, 0x3f6ea8);
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
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, gm.r * 0.9, 6),
          mkMat("dark")
        );
        stem.position.set(d.position.x, gm.r * 0.45, 0);
        g.add(stem);
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
    case "telescope": {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(gm.r, gm.r * 0.8, gm.len, 22, 1, true),
        mkMat("gold")
      );
      tube.material.side = THREE.DoubleSide;
      g.add(tube);
      const ap = new THREE.Mesh(
        new THREE.CircleGeometry(gm.r * 0.95, 22),
        new THREE.MeshStandardMaterial({
          color: 0x0a0f14,
          roughness: 0.2,
          metalness: 0.9,
        })
      );
      ap.rotation.x = Math.PI / 2;
      ap.position.y = -gm.len / 2 + 0.01;
      g.add(ap);
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
    default: {
      const m = box(0.3, 0.1, 0.3, "shell");
      g.add(m);
    }
  }
  return g;
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
      pos.set(
        (rank.up % 3) * 0.5 - 0.5,
        yUp,
        Math.floor(rank.up / 3) * 0.45 - 0.3
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

