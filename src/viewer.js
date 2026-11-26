import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_DIRECTION = new THREE.Vector3(0.85, 0.52, 1.7).normalize();

export class ModelViewer {
  constructor(stage, onPick) {
    this.stage = stage;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(37, 1, 0.002, 500);
    this.camera.position.copy(DEFAULT_DIRECTION).multiplyScalar(5);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.setAttribute('aria-label', 'Có thể kéo để xoay và bấm để chọn cấu kiện');
    stage.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minDistance = 0.03;
    this.controls.maxDistance = 400;
    this.controls.addEventListener('change', () => this.draw());
    this.scene.add(new THREE.HemisphereLight(0xf4f9ff, 0x53637b, 2.05));
    const light = new THREE.DirectionalLight(0xfff7de, 2.15);
    light.position.set(2, 4, 6);
    this.scene.add(light);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.items = new Map();
    this.body = {
      normal: new THREE.MeshStandardMaterial({ color: 0xa3b5ca, roughness: 0.85, side: THREE.DoubleSide }),
      muted: new THREE.MeshStandardMaterial({ color: 0x9bafc6, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.13, depthWrite: false }),
      selected: new THREE.MeshStandardMaterial({ color: 0xffb322, emissive: 0x6b3600, emissiveIntensity: 0.24, roughness: 0.82, side: THREE.DoubleSide })
    };
    this.edge = {
      normal: new THREE.LineBasicMaterial({ color: 0x566a82, opacity: 0.65, transparent: true }),
      muted: new THREE.LineBasicMaterial({ color: 0x69809a, opacity: 0.29, transparent: true, depthWrite: false }),
      selected: new THREE.LineBasicMaterial({ color: 0xa04f00, transparent: true, opacity: 0.86, depthTest: false, depthWrite: false })
    };
    this.grid = null;
    this.raycaster = new THREE.Raycaster();
    const canvas = this.renderer.domElement;
    let first = null;
    canvas.addEventListener('pointerdown', event => {
      first = event.isPrimary ? [event.clientX, event.clientY] : null;
    });
    canvas.addEventListener('pointercancel', () => { first = null; });
    canvas.addEventListener('pointerup', event => {
      if (first && event.isPrimary && Math.hypot(event.clientX - first[0], event.clientY - first[1]) < 6) {
        const selected = this.pick(event.clientX, event.clientY);
        if (selected) onPick(selected);
      }
      first = null;
    });
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
  }

  setProject(parts) {
    for (const item of this.items.values()) {
      item.mesh.geometry.dispose();
      item.lines.geometry.dispose();
    }
    this.group.clear();
    this.items.clear();
    for (const part of parts) {
      if (part.triangles.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      const points = new Float32Array(part.vertices.length);
      for (let i = 0; i < part.vertices.length; i += 3) {
        points[i] = part.vertices[i] / 1000;
        points[i + 1] = part.vertices[i + 2] / 1000;
        points[i + 2] = -part.vertices[i + 1] / 1000;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
      geometry.setIndex(part.triangles);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, this.body.normal);
      mesh.userData.partId = part.id;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24), this.edge.normal);
      mesh.add(lines);
      this.group.add(mesh);
      this.items.set(part.id, { mesh, lines, part });
    }
  }

  setGroup(name) {
    for (const item of this.items.values()) {
      item.mesh.visible = name === null || item.part.group === name;
    }
    this.updateGrid(this.bounds());
    this.draw();
  }

  highlight(id) {
    for (const item of this.items.values()) {
      const style = !id ? 'normal' : item.part.id === id ? 'selected' : 'muted';
      item.mesh.material = this.body[style];
      item.lines.material = this.edge[style];
      item.lines.renderOrder = style === 'selected' ? 2 : 1;
    }
    this.draw();
  }

  bounds() {
    const result = new THREE.Box3();
    for (const { mesh } of this.items.values()) {
      if (mesh.visible) result.union(mesh.geometry.boundingBox);
    }
    return result;
  }

  fit(id, reset = false) {
    const groupBounds = this.bounds();
    if (groupBounds.isEmpty()) return;
    const partBounds = this.items.get(id)?.mesh.geometry.boundingBox;
    const target = groupBounds.getCenter(new THREE.Vector3());
    let radius = groupBounds.getBoundingSphere(new THREE.Sphere()).radius;
    if (partBounds) {
      const partSphere = partBounds.getBoundingSphere(new THREE.Sphere());
      if (radius > 5 * partSphere.radius) {
        target.copy(partSphere.center);
        radius = Math.min(radius, Math.max(partSphere.radius * 2, 0.24));
      } else {
        target.lerp(partSphere.center, 0.2);
        radius *= 1.08;
      }
    }
    const heightAngle = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const widthAngle = Math.atan(Math.tan(heightAngle) * this.camera.aspect);
    const distance = Math.max(radius, 0.035) * 1.06 / Math.sin(Math.min(heightAngle, widthAngle));
    const direction = reset ? DEFAULT_DIRECTION : this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.far = Math.max(500, distance * 6);
    this.controls.maxDistance = Math.max(400, distance * 4);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.draw();
  }

  updateGrid(bounds) {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
      this.grid = null;
    }
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const width = Math.max(size.x, size.y * 0.75, size.z, 0.25) * 1.9;
    this.grid = new THREE.GridHelper(width, 20, 0x9cadc0, 0xb2c3d5);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.47;
    this.grid.material.depthWrite = false;
    this.grid.position.set(center.x, bounds.min.y - width / 110, center.z);
    this.scene.add(this.grid);
  }

  pick(x, y) {
    const { left, top, width, height } = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((x - left) / width * 2 - 1, 1 - (y - top) / height * 2), this.camera);
    const meshes = [...this.items.values()].map(item => item.mesh).filter(mesh => mesh.visible);
    return this.raycaster.intersectObjects(meshes, false)[0]?.object.userData.partId;
  }

  resize() {
    const { clientWidth, clientHeight } = this.stage;
    if (!clientWidth || !clientHeight) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.draw();
  }

  draw() {
    this.renderer.render(this.scene, this.camera);
  }
}
