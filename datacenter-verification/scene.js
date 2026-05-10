(function () {
const { asNumber, clamp } = window.DCVScoring;

const RACK_COUNT = 48;

class DatacenterScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe3e0);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(8, 5.3, 8);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.75, 0);
    this.controls.minDistance = 5.2;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.racks = [];
    this.activityCaps = [];
    this.storageSlots = [];
    this.fabricGroup = new THREE.Group();
    this.markerGroup = new THREE.Group();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.root.add(this.fabricGroup, this.markerGroup);

    this.createLights();
    this.createShell();
    this.createRacks();
    this.createStorageBay();
    this.createPowerPlane();
    this.createIntegrityFrame();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.animate();
  }

  createLights() {
    const ambient = new THREE.HemisphereLight(0xffffff, 0xb8beb9, 2.4);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    this.scene.add(key);
  }

  createShell() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9.4, 5.8),
      new THREE.MeshStandardMaterial({ color: 0xcbd0cc, roughness: 0.8, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.04;
    floor.receiveShadow = true;
    this.root.add(floor);

    const shellGeometry = new THREE.BoxGeometry(9.6, 3.3, 6.1);
    const shell = new THREE.Mesh(
      shellGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xaeb6b2,
        transparent: true,
        opacity: 0.13,
        roughness: 0.7,
        metalness: 0.08,
        depthWrite: false,
      })
    );
    shell.position.y = 1.6;
    this.root.add(shell);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(shellGeometry),
      new THREE.LineBasicMaterial({ color: 0x49514d, transparent: true, opacity: 0.74 })
    );
    edges.position.copy(shell.position);
    this.root.add(edges);
  }

  createRacks() {
    const rackGeometry = new THREE.BoxGeometry(0.42, 1.2, 0.48);
    const activityGeometry = new THREE.BoxGeometry(0.46, 0.08, 0.52);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x8e9994,
      roughness: 0.58,
      metalness: 0.18,
      transparent: true,
      opacity: 0.78,
    });
    const activityMaterial = new THREE.MeshBasicMaterial({
      color: 0x14966f,
      transparent: true,
      opacity: 0,
    });
    for (let index = 0; index < RACK_COUNT; index += 1) {
      const col = index % 12;
      const row = Math.floor(index / 12);
      const rack = new THREE.Mesh(rackGeometry, baseMaterial.clone());
      const activityCap = new THREE.Mesh(activityGeometry, activityMaterial.clone());
      rack.castShadow = true;
      rack.receiveShadow = true;
      rack.position.set(-4.05 + col * 0.74, 0.58, -2.02 + row * 1.35);
      rack.userData.baseY = rack.position.y;
      activityCap.position.set(rack.position.x, 1.24, rack.position.z);
      activityCap.visible = false;
      activityCap.castShadow = true;
      this.racks.push(rack);
      this.activityCaps.push(activityCap);
      this.root.add(rack);
      this.root.add(activityCap);
    }
  }

  createStorageBay() {
    const slotGeometry = new THREE.BoxGeometry(0.42, 0.22, 0.42);
    const slotMaterial = new THREE.MeshStandardMaterial({
      color: 0x8f8797,
      roughness: 0.72,
      metalness: 0.06,
      transparent: true,
      opacity: 0.54,
    });
    for (let index = 0; index < 9; index += 1) {
      const slot = new THREE.Mesh(slotGeometry, slotMaterial.clone());
      slot.position.set(-3.7 + index * 0.92, 0.12, 2.45);
      slot.castShadow = true;
      slot.receiveShadow = true;
      this.storageSlots.push(slot);
      this.root.add(slot);
    }
  }

  createPowerPlane() {
    this.powerPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(9.1, 5.35),
      new THREE.MeshBasicMaterial({
        color: 0xd97925,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.powerPlane.rotation.x = -Math.PI / 2;
    this.powerPlane.position.y = 0.015;
    this.root.add(this.powerPlane);
  }

  createIntegrityFrame() {
    const geometry = new THREE.BoxGeometry(9.75, 3.45, 6.25);
    this.integrityFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0xc43f4d,
        transparent: true,
        opacity: 0,
      })
    );
    this.integrityFrame.position.y = 1.62;
    this.root.add(this.integrityFrame);
  }

  update(features, result) {
    const capacity = Math.max(1, asNumber(features.o1_normalized_h100e_capacity, 1));
    const allocation = asNumber(features.o2_max_concurrent_normalized_gpus);
    const gpuUtil = clamp(asNumber(features.o4_gpu_util_p95) / 100);
    const fabric = Math.max(
      clamp(asNumber(features.o7_collective_periodicity_score)),
      clamp(asNumber(features.o7_synchronized_fabric_footprint) / Math.max(capacity, 1))
    );
    const power = clamp(asNumber(features.o8_rack_power_fraction_p95));
    const checkpoint = clamp(asNumber(features.o11_checkpoint_periodicity_score));
    const coverage = clamp(asNumber(features.o14_min_critical_coverage, 1));
    const activeFraction = clamp(allocation / capacity);
    const activeRacks = Math.round(activeFraction * RACK_COUNT);
    const allocationColor = new THREE.Color(0x3c78a8);
    const inactiveColor = new THREE.Color(0x8e9994);

    this.racks.forEach((rack, index) => {
      const active = index < activeRacks;
      const activityCap = this.activityCaps[index];
      const material = rack.material;
      const target = inactiveColor.clone();
      if (active) {
        target.copy(allocationColor);
      }
      material.color.copy(target);
      material.opacity = active ? 0.88 : 0.28;
      rack.scale.y = active ? 1 + gpuUtil * 0.42 : 0.72;
      rack.position.y = rack.userData.baseY + (rack.scale.y - 1) * 0.58;
      activityCap.visible = active && gpuUtil > 0.04;
      activityCap.material.opacity = active ? 0.28 + gpuUtil * 0.7 : 0;
      activityCap.position.set(rack.position.x, rack.position.y + rack.scale.y * 0.62 + 0.045, rack.position.z);
    });

    this.powerPlane.material.opacity = power * 0.32;
    this.integrityFrame.material.opacity = result.integrityWarning || coverage < 0.8 ? 0.84 : 0;
    this.updateFabricLines(activeRacks, fabric);
    this.updateStorageMarkers(checkpoint, result.label);
  }

  updateFabricLines(activeRacks, fabric) {
    this.fabricGroup.clear();
    const lineCount = Math.min(34, Math.round(fabric * 38));
    if (!lineCount || activeRacks < 2) return;
    const positions = [];
    const capped = Math.max(2, Math.min(activeRacks, this.racks.length));
    for (let index = 0; index < lineCount; index += 1) {
      const a = this.racks[index % capped].position;
      const b = this.racks[(index * 7 + 5) % capped].position;
      positions.push(a.x, 1.36 + (index % 5) * 0.045, a.z);
      positions.push(b.x, 1.36 + ((index + 2) % 5) * 0.045, b.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x198fb2,
        transparent: true,
        opacity: 0.2 + fabric * 0.72,
      })
    );
    this.fabricGroup.add(lines);
  }

  updateStorageMarkers(checkpoint, label) {
    this.markerGroup.clear();
    const count = Math.min(9, Math.round(checkpoint * 10));
    if (!count) return;
    const geometry = new THREE.BoxGeometry(0.42, 0.1, 0.42);
    const material = new THREE.MeshBasicMaterial({
      color: 0x8c5fb7,
      transparent: true,
      opacity: 0.92,
    });
    for (let index = 0; index < count; index += 1) {
      const marker = new THREE.Mesh(geometry, material.clone());
      const slot = this.storageSlots[index];
      const x = slot ? slot.position.x : -3.7 + index * 0.92;
      const z = slot ? slot.position.z : 2.45;
      marker.position.set(x, 0.37 + index * 0.018, z);
      marker.castShadow = true;
      this.markerGroup.add(marker);
    }
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.animate());
  }
}

window.DatacenterScene = DatacenterScene;
})();
