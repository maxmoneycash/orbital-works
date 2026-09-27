import * as THREE from 'three';
import { calculateSunPosition } from '../astro/sun';

const SUN_DISTANCE = 200; // draw units (beyond moon at ~128)
const SUN_DISC_SIZE = 1.8; // matches real angular diameter (~0.53 deg, same as moon)
/** Beyond Sun–Earth L2 (~500 units) and inside the camera's far plane. */
const FAR_SUN_DISTANCE = 7000;

export class SunScene {
  readonly disc: THREE.Sprite;

  constructor() {
    const tex = this.makeDiscTexture(256);
    this.disc = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      depthWrite: false,
    }));
    this.disc.scale.set(SUN_DISC_SIZE, SUN_DISC_SIZE, 1);
  }

  /**
   * `far`: the camera is out in deep space, beyond where the Sun's stand-in
   * distance works; push it out past L2 at the same apparent size.
   */
  update(epoch: number, far = false) {
    const d = far ? FAR_SUN_DISTANCE : SUN_DISTANCE;
    this.disc.position.copy(calculateSunPosition(epoch)).multiplyScalar(d);
    this.disc.scale.setScalar((SUN_DISC_SIZE * d) / SUN_DISTANCE);
  }

  setBloomEnabled(enabled: boolean) {
    (this.disc.material as THREE.SpriteMaterial).color.setScalar(enabled ? 2.0 : 1.0);
  }

  setVisible(visible: boolean) {
    this.disc.visible = visible;
  }

  private makeDiscTexture(size: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const half = size / 2;

    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0.0, '#ffffff');
    grad.addColorStop(0.6, '#fff8e0');
    grad.addColorStop(0.85, '#ffe080');
    grad.addColorStop(0.95, '#ff800020');
    grad.addColorStop(1.0, '#ff800000');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }
}
