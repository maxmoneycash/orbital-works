/**
 * The focused telemetry frame on the globe: the ground station that heard it,
 * the satellite where it was at that moment, the pass it was heard on, and
 * the downlink between them, with packets running down it.
 *
 * Everything is placed in the Earth-fixed frame and the group is turned with
 * the Earth, so the satellite sits over the ground it was over when the
 * station heard it, on the globe as it is drawn now.
 */
import * as THREE from 'three';
import { DEG2RAD, DRAW_SCALE } from '../constants';
import { latLonToSurface } from '../astro/coordinates';
import { parseTLE, calculatePosition } from '../astro/propagator';
import { unixToEpoch, epochToGmst } from '../astro/epoch';
import type { TelemetryObservation } from '../data/telemetry';

const PACKETS = 6;
const ARC_STEP_S = 15;

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TelemetryLayer {
  readonly group = new THREE.Group();
  private color = new THREE.Color('#44ff44');
  private key = '';
  private station = new THREE.Vector3();
  private sat = new THREE.Vector3();
  private arc: THREE.Line;
  private link: THREE.Line;
  private stationDot: THREE.Sprite;
  private stationRing: THREE.Sprite;
  private satDot: THREE.Sprite;
  private packets: THREE.Points;
  private dot = dotTexture();
  private pulseAt = 0;
  private host: HTMLDivElement;
  private satLabel: HTMLDivElement;
  private stnLabel: HTMLDivElement;
  private tmp = new THREE.Vector3();

  constructor(uiRoot: HTMLElement) {
    this.group.visible = false;
    // Name chips, in the style of the deep-space labels: ink on a scrim with a live rule.
    this.host = document.createElement('div');
    this.host.className = 'telemetry-labels';
    Object.assign(this.host.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', display: 'none', zIndex: '40' });
    const chip = () => {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', font: '500 11px/15px "Overpass Mono", ui-monospace, monospace',
        color: '#f2f1ec', background: 'rgba(0,0,0,0.72)', padding: '2px 7px 2px 6px',
        borderLeft: '1px solid var(--live)', letterSpacing: '0.01em', willChange: 'transform',
      } satisfies Partial<CSSStyleDeclaration>);
      this.host.append(d);
      return d;
    };
    this.satLabel = chip();
    this.stnLabel = chip();
    uiRoot.prepend(this.host);
    this.group.renderOrder = 5;

    this.arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.link = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.85, depthWrite: false }));
    const sprite = (map: THREE.Texture) => new THREE.Sprite(new THREE.SpriteMaterial({ map, color: this.color, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this.stationDot = sprite(this.dot);
    this.stationRing = sprite(ringTexture());
    this.satDot = sprite(this.dot);

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PACKETS * 3), 3));
    this.packets = new THREE.Points(pg, new THREE.PointsMaterial({ map: this.dot, color: this.color, size: 9, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));

    this.group.add(this.arc, this.link, this.stationRing, this.stationDot, this.satDot, this.packets);
  }

  setColor(css: string) {
    const next = new THREE.Color(css);
    if (next.equals(this.color)) return;
    this.color.copy(next);
    for (const m of [this.link.material, this.stationDot.material, this.stationRing.material, this.satDot.material, this.packets.material] as THREE.Material[]) {
      (m as THREE.LineBasicMaterial).color?.set(css);
    }
    this.key = ''; // rebuild the arc's colours
  }

  /** Where the satellite was at `unixS`, in the Earth-fixed frame, in scene units. */
  private fixedAt(s: ReturnType<typeof parseTLE>, unixS: number, offsetDeg: number, out: THREE.Vector3) {
    const epoch = unixToEpoch(unixS);
    calculatePosition(s!, epoch, out).divideScalar(DRAW_SCALE);
    // Undo the Earth's turn at that moment; the group applies today's.
    return out.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -(epochToGmst(epoch) + offsetDeg) * DEG2RAD);
  }

  private build(obs: TelemetryObservation, t: string, offsetDeg: number) {
    const s = parseTLE(obs.satellite, obs.tle[0], obs.tle[1]);
    if (!s) return false;
    this.station.copy(latLonToSurface(obs.station.lat, obs.station.lon, 0, 0)).multiplyScalar(1.002);
    const t0 = Date.parse(obs.start) / 1000, t1 = Date.parse(obs.end) / 1000, tf = Date.parse(t) / 1000;
    this.fixedAt(s, tf, offsetDeg, this.sat);

    // The pass: faint before and after the frame, brighter where it was heard.
    const pts: number[] = [], cols: number[] = [];
    const v = new THREE.Vector3();
    const n = Math.max(2, Math.ceil((t1 - t0) / ARC_STEP_S));
    for (let i = 0; i <= n; i++) {
      const ts = t0 + ((t1 - t0) * i) / n;
      this.fixedAt(s, ts, offsetDeg, v);
      pts.push(v.x, v.y, v.z);
      const k = Math.max(0.12, 1 - Math.abs(ts - tf) / Math.max(60, (t1 - t0) / 2));
      cols.push(this.color.r * k, this.color.g * k, this.color.b * k);
    }
    const g = this.arc.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeBoundingSphere();
    this.link.geometry.setFromPoints([this.station, this.sat]);
    this.link.geometry.computeBoundingSphere();
    this.pulseAt = performance.now();
    this.satLabel.textContent = `${obs.satellite} · ${t.slice(11, 19)}Z`;
    this.stnLabel.textContent = obs.station.name.length > 34 ? obs.station.name.slice(0, 33) + '…' : obs.station.name;
    return true;
  }

  /** Earth-fixed position of the focused station, for turning the camera to it. */
  get stationFixed() { return this.station; }

  update(focus: { obs: TelemetryObservation; t: string } | null, show: boolean, gmstDeg: number, offsetDeg: number, camera: THREE.Camera) {
    if (!show || !focus) { this.group.visible = false; this.host.style.display = 'none'; return; }
    const key = `${focus.obs.id}:${focus.t}`;
    if (key !== this.key) {
      this.key = key;
      if (!this.build(focus.obs, focus.t, offsetDeg)) { this.group.visible = false; this.host.style.display = 'none'; return; }
    }
    this.group.visible = true;
    this.group.rotation.y = (gmstDeg + offsetDeg) * DEG2RAD;

    // Sprites keep a steady size on screen as the camera moves in and out.
    const d = camera.position.length();
    const px = d * 0.0016;
    this.stationDot.position.copy(this.station);
    this.stationDot.scale.setScalar(px * 5);
    this.satDot.position.copy(this.sat);
    this.satDot.scale.setScalar(px * 9);
    const now = performance.now();
    const pulse = ((now - this.pulseAt) % 1800) / 1800;
    this.stationRing.position.copy(this.station);
    this.stationRing.scale.setScalar(px * (6 + 22 * pulse));
    (this.stationRing.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - pulse);

    // Packets run down the link, satellite to station.
    const arr = (this.packets.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < PACKETS; i++) {
      const u = ((now / 1400) + i / PACKETS) % 1;
      arr[i * 3] = this.sat.x + (this.station.x - this.sat.x) * u;
      arr[i * 3 + 1] = this.sat.y + (this.station.y - this.sat.y) * u;
      arr[i * 3 + 2] = this.sat.z + (this.station.z - this.sat.z) * u;
    }
    this.packets.geometry.getAttribute('position').needsUpdate = true;
    this.packets.geometry.computeBoundingSphere();

    // Chips follow their points, and hide when the point is behind the Earth or off screen.
    this.group.updateMatrixWorld();
    this.host.style.display = '';
    this.place(this.satLabel, this.sat, camera, 12, -9, false);
    this.place(this.stnLabel, this.station, camera, 12, 4, true);
  }

  private place(el: HTMLDivElement, local: THREE.Vector3, camera: THREE.Camera, dx: number, dy: number, onSurface: boolean) {
    const w = this.group.localToWorld(this.tmp.copy(local));
    const toCam = camera.position.clone().sub(w);
    // A surface point faces away once its normal turns from the camera; a point in orbit
    // is hidden only when the Earth's disc covers it.
    let hidden = onSurface ? w.dot(toCam) <= 0 : false;
    if (!onSurface) {
      const d = toCam.length(), dir = toCam.divideScalar(d);
      const tca = -w.dot(dir), r = 6378.137 / 3000;
      hidden = tca > 0 && tca < d && w.lengthSq() - tca * tca < r * r;
    }
    const v = w.project(camera);
    const W = this.host.clientWidth, H = this.host.clientHeight;
    const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
    if (hidden || v.z > 1 || x < 0 || x > W - 40 || y < 10 || y > H - 10) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(${Math.round(x + dx)}px, ${Math.round(y + dy)}px)`;
  }
}
