import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type CameraView = 'front' | 'side' | 'top' | 'drummer';

const VIEWS: Record<CameraView, [THREE.Vector3, THREE.Vector3]> = {
  front: [new THREE.Vector3(1.1, 1.55, -2.1), new THREE.Vector3(0, 0.85, -0.1)],
  side: [new THREE.Vector3(2.4, 1.4, 0.1), new THREE.Vector3(0, 0.8, -0.1)],
  top: [new THREE.Vector3(0, 3.0, -0.05), new THREE.Vector3(0, 0.6, -0.1)],
  drummer: [new THREE.Vector3(0.55, 1.95, 1.3), new THREE.Vector3(-0.05, 0.7, -0.35)],
};

/** 렌더러·카메라·조명·바닥. 마우스로 자유롭게 돌려 볼 수 있다. */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private viewTween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; u: number } | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0e0f13);
    this.scene.fog = new THREE.Fog(0x0e0f13, 6, 14);

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20160f, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 3.5, -1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 2;
    key.shadow.camera.bottom = -2;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rim = new THREE.SpotLight(0xff8a3d, 18, 8, 0.6, 0.6);
    rim.position.set(-2, 3, 2);
    rim.target.position.set(0, 0.8, 0);
    this.scene.add(rim, rim.target);
    const fill = new THREE.SpotLight(0x3d9bff, 14, 8, 0.6, 0.6);
    fill.position.set(2.2, 2.5, 1.8);
    fill.target.position.set(0, 0.8, 0);
    this.scene.add(fill, fill.target);

    const riser = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.65, 0.04, 64),
      new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: 0.9 }),
    );
    riser.position.y = -0.02;
    riser.receiveShadow = true;
    this.scene.add(riser);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), new THREE.MeshStandardMaterial({ color: 0x3a1f2a, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.001;
    rug.receiveShadow = true;
    this.scene.add(rug);
    const grid = new THREE.GridHelper(12, 48, 0x22252e, 0x16181d);
    grid.position.y = -0.04;
    this.scene.add(grid);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    const [pos, target] = VIEWS.front;
    this.camera.position.copy(pos);
    this.controls.target.copy(target);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setView(view: CameraView) {
    const [pos, target] = VIEWS[view];
    this.viewTween = { from: this.camera.position.clone(), to: pos, fromT: this.controls.target.clone(), toT: target, u: 0 };
  }

  render(dt: number) {
    if (this.viewTween) {
      const tw = this.viewTween;
      tw.u = Math.min(1, tw.u + dt * 2.2);
      const e = tw.u * tw.u * (3 - 2 * tw.u);
      this.camera.position.lerpVectors(tw.from, tw.to, e);
      this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
      if (tw.u >= 1) this.viewTween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
