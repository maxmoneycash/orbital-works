/**
 * Light at L2 for the Roman model: where the Sun sits in the model's own frame,
 * and the dim studio environment its metals reflect.
 */
import * as THREE from 'three';

/** The Sun, from the sun side (+Z), a little high and to the right. */
export const SUN_DIR = new THREE.Vector3(0.42, 0.34, 1).normalize();

/**
 * L2 has no Earth below to fill the shadows: one brutal sun and black. That is
 * correct and unreadable, so two dim reflection cards give the metals shape the
 * way a studio would, while the sky itself stays black.
 */
export function makeL2Environment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vN; void main(){ float h = vN.y * 0.5 + 0.5; gl_FragColor = vec4(mix(vec3(0.012,0.013,0.018), vec3(0.07,0.078,0.095), h), 1.0); }',
  }));
  env.add(sky);
  const card = (w: number, h: number, color: number, gain: number, pos: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    (m.material as THREE.MeshBasicMaterial).color.multiplyScalar(gain);
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  // Broad soft cards: silver blankets and metal read by what they reflect,
  // and black space alone would leave them black.
  card(34, 24, 0xfff1dc, 3.2, SUN_DIR.clone().multiplyScalar(38).add(new THREE.Vector3(0, 6, 0)));
  card(36, 14, 0x9fb4d6, 0.9, SUN_DIR.clone().multiplyScalar(-38));
  card(46, 8, 0xffffff, 1.1, new THREE.Vector3(0, 40, 0));
  card(20, 30, 0xc8d6ee, 0.6, new THREE.Vector3(-38, 4, 8));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  (sun.material as THREE.MeshBasicMaterial).color.setScalar(40);
  sun.position.copy(SUN_DIR).multiplyScalar(44);
  env.add(sun);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  });
  return tex;
}
