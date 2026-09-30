import * as THREE from "three";

type Vec = [number, number, number];
type Surface = "stone" | "glass" | "metal" | "leaf" | "warm";
type Primitive = "box" | "sphere" | "cylinder";
type Instance = { matrix: THREE.Matrix4; color: THREE.Color };

// Authored miniature, not a surveyed reconstruction of Semey. Repeated
// windows, leaf clusters, paving joints and railings share instanced draws.
class Resources {
  geometries = new Set<THREE.BufferGeometry>();
  materials = new Set<THREE.Material>();
  textures = new Set<THREE.Texture>();
  shapes = {
    box: this.geometry(new THREE.BoxGeometry(1, 1, 1)),
    sphere: this.geometry(new THREE.SphereGeometry(1, 10, 7)),
    cylinder: this.geometry(new THREE.CylinderGeometry(0.7, 1, 1, 8)),
  };
  surfaces: Record<Surface, THREE.MeshStandardMaterial> = {
    stone: this.material(new THREE.MeshStandardMaterial({ roughness: 0.86 })),
    glass: this.material(
      new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.42 }),
    ),
    metal: this.material(
      new THREE.MeshStandardMaterial({ roughness: 0.49, metalness: 0.5 }),
    ),
    leaf: this.material(new THREE.MeshStandardMaterial({ roughness: 0.97 })),
    warm: this.material(
      new THREE.MeshStandardMaterial({
        roughness: 0.55,
        emissive: "#dc9b53",
        emissiveIntensity: 0.34,
      }),
    ),
  };
  geometry<T extends THREE.BufferGeometry>(value: T): T {
    this.geometries.add(value);
    return value;
  }
  material<T extends THREE.Material>(value: T): T {
    this.materials.add(value);
    return value;
  }
  dispose(root: THREE.Group) {
    root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.geometries.forEach((value) => value.dispose());
    this.materials.forEach((value) => value.dispose());
    this.textures.forEach((value) => value.dispose());
  }
}

class Parts {
  private batches = new Map<
    string,
    { primitive: Primitive; surface: Surface; instances: Instance[] }
  >();
  constructor(private resources: Resources) {}
  add(
    primitive: Primitive,
    position: Vec,
    scale: Vec,
    color: string,
    surface: Surface = "stone",
    rotation: Vec = [0, 0, 0],
  ) {
    const key = `${primitive}:${surface}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { primitive, surface, instances: [] };
      this.batches.set(key, batch);
    }
    batch.instances.push({
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
        new THREE.Vector3(...scale),
      ),
      color: new THREE.Color(color),
    });
  }
  box(
    p: Vec,
    s: Vec,
    c: string,
    surface: Surface = "stone",
    r: Vec = [0, 0, 0],
  ) {
    this.add("box", p, s, c, surface, r);
  }
  sphere(p: Vec, s: Vec, c: string, surface: Surface = "leaf") {
    this.add("sphere", p, s, c, surface);
  }
  rod(
    a: Vec,
    b: Vec,
    radius: number,
    color: string,
    surface: Surface = "metal",
  ) {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b);
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const rotation = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        end.sub(start).normalize(),
      ),
    );
    this.add(
      "cylinder",
      midpoint.toArray(),
      [
        radius,
        new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)),
        radius,
      ],
      color,
      surface,
      [rotation.x, rotation.y, rotation.z],
    );
  }
  finish(name: string) {
    const group = new THREE.Group();
    group.name = name;
    this.batches.forEach(({ primitive, surface, instances }) => {
      const mesh = new THREE.InstancedMesh(
        this.resources.shapes[primitive],
        this.resources.surfaces[surface],
        instances.length,
      );
      mesh.name = `${name}-${primitive}-${surface}`;
      instances.forEach(({ matrix, color }, i) => {
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, color);
      });
      mesh.castShadow = surface !== "warm";
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
    return group;
  }
}

const noise = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const limestone = "#c5c1b5",
  trim = "#e0dace",
  pavement = "#b6b5a7",
  dark = "#394b4b";

function tree(
  parts: Parts,
  x: number,
  z: number,
  seed: number,
  scale = 1,
  base = 0.36,
) {
  const height = (0.86 + noise(seed) * 0.36) * scale;
  parts.rod(
    [x, base, z],
    [x + 0.025 * scale, base + height * 0.79, z],
    0.038 * scale,
    "#675c49",
    "stone",
  );
  const colors = ["#526246", "#657453", "#76815b", "#465d45", "#5e7252"];
  for (let c = 0; c < 7; c++) {
    const angle = c * 2.399 + seed;
    const spread = c === 6 ? 0.03 : (0.18 + noise(seed + c * 5) * 0.12) * scale;
    const dx = Math.cos(angle) * spread,
      dz = Math.sin(angle) * spread;
    const y = base + height * (0.69 + noise(seed + c * 7) * 0.31);
    const radius = (0.19 + noise(seed + c * 11) * 0.12) * scale;
    parts.sphere(
      [x + dx, y, z + dz],
      [radius, radius * (1.12 + noise(seed + c) * 0.35), radius * 0.94],
      colors[(seed + c) % colors.length]!,
    );
    if (c % 2 === 0)
      parts.rod(
        [x, base + height * 0.44, z],
        [x + dx, y, z + dz],
        0.015 * scale,
        "#71634c",
        "stone",
      );
  }
  parts.add(
    "cylinder",
    [x, base - 0.037, z],
    [0.24 * scale, 0.115, 0.24 * scale],
    "#7a7c62",
    "stone",
  );
}

function lamp(parts: Parts, x: number, z: number, base = 0.38, facing = 1) {
  parts.add("cylinder", [x, base + 0.025, z], [0.064, 0.05, 0.064], "#6e756b");
  parts.rod([x, base, z], [x, base + 1.02, z], 0.016, "#42514d");
  parts.rod(
    [x, base + 1.02, z],
    [x + 0.16 * facing, base + 1.07, z],
    0.014,
    "#42514d",
  );
  parts.box(
    [x + 0.16 * facing, base + 1.06, z],
    [0.22, 0.035, 0.1],
    "#424f49",
    "metal",
  );
  parts.box(
    [x + 0.16 * facing, base + 1.036, z],
    [0.15, 0.01, 0.064],
    "#ebc58b",
    "warm",
  );
}

function bench(parts: Parts, x: number, z: number, flip = 1) {
  for (let s = 0; s < 3; s++)
    parts.box([x, 0.47, z + (s - 1) * 0.052], [0.47, 0.025, 0.041], "#947554");
  for (const dx of [-0.17, 0.17]) {
    parts.box([x + dx, 0.415, z], [0.026, 0.1, 0.18], dark, "metal");
    parts.box(
      [x + dx, 0.56, z - 0.08 * flip],
      [0.022, 0.21, 0.024],
      dark,
      "metal",
    );
  }
  parts.box([x, 0.595, z - 0.08 * flip], [0.47, 0.09, 0.025], "#9b7b55");
}

function person(parts: Parts, x: number, z: number, seed: number, base = 0.36) {
  const colors = ["#955a43", "#445961", "#ded4b9", "#343e42", "#8f946b"];
  const stride = seed % 3 === 0 ? 0.024 : -0.01;
  parts.rod(
    [x - 0.025, base + 0.11, z],
    [x - 0.03, base + 0.018, z + stride],
    0.015,
    "#404a46",
    "stone",
  );
  parts.rod(
    [x + 0.022, base + 0.11, z],
    [x + 0.027, base + 0.018, z - stride],
    0.015,
    "#404a46",
    "stone",
  );
  parts.sphere(
    [x, base + 0.157, z],
    [0.05, 0.068, 0.031],
    colors[seed % colors.length]!,
    "stone",
  );
  parts.sphere([x, base + 0.248, z], [0.032, 0.037, 0.032], "#bb987c", "stone");
  parts.sphere(
    [x, base + 0.269, z - 0.004],
    [0.034, 0.021, 0.032],
    seed % 2 ? "#665946" : "#3f443e",
    "stone",
  );
  parts.rod(
    [x - 0.038, base + 0.189, z],
    [x - 0.056, base + 0.113, z - stride],
    0.012,
    colors[seed % colors.length]!,
    "stone",
  );
  parts.rod(
    [x + 0.038, base + 0.189, z],
    [x + 0.057, base + 0.119, z + stride],
    0.012,
    colors[seed % colors.length]!,
    "stone",
  );
}

function building(
  parts: Parts,
  spec: [number, number, number, number, number],
  index: number,
) {
  const [x, z, w, d, h] = spec,
    base = 0.37;
  const front = z + d / 2,
    side = x + w / 2;
  const colors = [limestone, "#d0cabd", "#bbbdb3", "#c1b9a9"];
  parts.box([x, 0.317, z], [w + 0.38, 0.106, d + 0.38], "#bdbfaf");
  parts.box([x, base + h / 2, z], [w, h, d], colors[index % colors.length]!);
  parts.box([x, base + 0.025, z], [w + 0.2, 0.05, d + 0.2], "#929b8a");
  parts.box([x, base + 0.08, z], [w + 0.08, 0.12, d + 0.08], "#9b9b90");
  const floors = Math.max(2, Math.floor(h / 0.47));
  const cols = Math.max(3, Math.floor(w / 0.35));
  const sideCols = Math.max(3, Math.floor(d / 0.35));
  const windowH = 0.3,
    step = (h - 0.2) / floors;
  for (let floor = 0; floor < floors; floor++) {
    const y = base + 0.27 + floor * step;
    parts.box([x, y + 0.19, front + 0.006], [w, 0.009, 0.009], "#a7a79c");
    parts.box([side + 0.006, y + 0.19, z], [0.009, 0.009, d], "#a7a79c");
    for (let col = 0; col < cols; col++) {
      const wx = x + ((col - (cols - 1) / 2) * w) / cols;
      const warm = (floor * 3 + col + index * 7) % 11 === 0;
      parts.box(
        [wx, y, front + 0.009],
        [(w / cols) * 0.49, windowH + 0.035, 0.025],
        "#687571",
      );
      parts.box(
        [wx, y + 0.008, front + 0.025],
        [(w / cols) * 0.4, windowH, 0.018],
        warm ? "#c3a16b" : "#344e54",
        warm ? "warm" : "glass",
      );
      parts.box(
        [wx, y - 0.157, front + 0.05],
        [(w / cols) * 0.59, 0.033, 0.07],
        trim,
      );
      parts.box(
        [wx, y, front + 0.038],
        [0.012, windowH, 0.014],
        "#82908a",
        "metal",
      );
      if (col === 0 || col === cols - 1)
        parts.box(
          [wx - 0.12, y, front + 0.035],
          [0.035, step, 0.055],
          "#d3cdbf",
        );
    }
    for (let col = 0; col < sideCols; col++) {
      const wz = z + ((col - (sideCols - 1) / 2) * d) / sideCols;
      parts.box(
        [side + 0.011, y, wz],
        [0.02, windowH + 0.035, (d / sideCols) * 0.48],
        "#7f8a80",
      );
      parts.box(
        [side + 0.027, y + 0.008, wz],
        [0.015, windowH, (d / sideCols) * 0.39],
        (col + floor + index) % 13 === 0 ? "#b39d72" : "#3f585b",
        "glass",
      );
      parts.box(
        [side + 0.046, y - 0.157, wz],
        [0.065, 0.03, (d / sideCols) * 0.57],
        trim,
      );
      parts.box(
        [side + 0.037, y, wz],
        [0.014, windowH, 0.012],
        "#9a9f91",
        "metal",
      );
    }
  }
  parts.box(
    [x, base + 0.17, front + 0.056],
    [0.28, 0.34, 0.045],
    "#354d50",
    "glass",
  );
  parts.box([x, base + 0.36, front + 0.19], [0.6, 0.044, 0.39], trim);
  for (const dx of [-0.255, 0.255])
    parts.box(
      [x + dx, base + 0.15, front + 0.28],
      [0.029, 0.31, 0.029],
      "#86918a",
      "metal",
    );
  parts.box([x, base + 0.011, front + 0.2], [0.6, 0.022, 0.35], "#d0cbbb");
  const roof = base + h;
  parts.box([x, roof + 0.015, z], [w + 0.07, 0.08, d + 0.07], trim);
  parts.box([x, roof + 0.063, z], [w - 0.09, 0.02, d - 0.09], "#717971");
  for (const dx of [-1, 1])
    parts.box(
      [x + dx * (w / 2 - 0.015), roof + 0.105, z],
      [0.065, 0.16, d + 0.03],
      "#d7d1c4",
    );
  for (const dz of [-1, 1])
    parts.box(
      [x, roof + 0.105, z + dz * (d / 2 - 0.015)],
      [w, 0.16, 0.065],
      "#d7d1c4",
    );
  if (index % 3 !== 2) {
    const panelW = (w - 0.34) / 3;
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++) {
        const px = x + (col - 1) * (panelW + 0.035),
          pz = z + (row - 0.5) * d * 0.27,
          panelD = d * 0.24;
        parts.box(
          [px, roof + 0.16, pz],
          [panelW, 0.028, panelD],
          "#afb5af",
          "metal",
          [-0.1, 0, 0],
        );
        parts.box(
          [px, roof + 0.179, pz],
          [panelW - 0.027, 0.009, panelD - 0.027],
          "#314b61",
          "glass",
          [-0.1, 0, 0],
        );
        for (let cell = 1; cell <= 2; cell++)
          parts.box(
            [px + ((cell - 1.5) * panelW) / 3, roof + 0.188, pz],
            [0.004, 0.003, panelD - 0.03],
            "#6f8c99",
            "metal",
            [-0.1, 0, 0],
          );
      }
  } else {
    parts.box(
      [x - w * 0.13, roof + 0.12, z],
      [w * 0.52, 0.11, d * 0.58],
      "#788367",
    );
    for (let i = 0; i < 5; i++)
      parts.sphere(
        [x - w * 0.29 + i * w * 0.087, roof + 0.24, z + Math.sin(i * 2) * 0.15],
        [0.16, 0.15, 0.16],
        "#647b50",
      );
  }
  parts.box(
    [x + w * 0.29, roof + 0.19, z - d * 0.32],
    [0.25, 0.22, 0.24],
    "#aaa99d",
  );
  parts.box(
    [x + w * 0.29, roof + 0.309, z - d * 0.32],
    [0.22, 0.016, 0.22],
    "#747f79",
    "metal",
  );
  for (let slat = 0; slat < 4; slat++)
    parts.box(
      [x + w * 0.29 - 0.074 + slat * 0.05, roof + 0.32, z - d * 0.32],
      [0.012, 0.012, 0.18],
      "#bac1b3",
      "metal",
    );
  if (index === 1 || index === 3)
    parts.box(
      [x - w * 0.28, base + h * 0.52, front + 0.058],
      [0.078, h * 0.91, 0.042],
      "#a87755",
    );
}

function vehicle(resources: Resources, isBus: boolean, color: string) {
  const parts = new Parts(resources),
    length = isBus ? 1.22 : 0.64;
  parts.box([0, 0.14, 0], [length, 0.23, 0.34], color);
  parts.box([0, 0.036, 0], [length * 0.95, 0.036, 0.33], "#334342", "metal");
  if (isBus) {
    parts.box([0, 0.277, 0], [length * 0.97, 0.065, 0.32], "#d8d2bf");
    for (let i = 0; i < 6; i++)
      for (const side of [-1, 1])
        parts.box(
          [-0.46 + i * 0.18, 0.204, side * 0.173],
          [0.142, 0.131, 0.01],
          "#2f444a",
          "glass",
        );
    parts.box([0.6, 0.208, 0], [0.018, 0.14, 0.27], "#30474d", "glass");
    parts.box([0.13, 0.334, 0], [0.34, 0.044, 0.22], "#b3bab2");
  } else {
    parts.box([-0.027, 0.283, 0], [0.35, 0.103, 0.286], color);
    parts.box(
      [0.162, 0.25, 0],
      [0.024, 0.11, 0.257],
      "#405960",
      "glass",
      [0, 0, -0.23],
    );
    parts.box(
      [-0.23, 0.25, 0],
      [0.02, 0.102, 0.257],
      "#405960",
      "glass",
      [0, 0, 0.22],
    );
    for (const side of [-1, 1])
      parts.box(
        [-0.03, 0.265, side * 0.146],
        [0.31, 0.082, 0.014],
        "#3a5156",
        "glass",
      );
  }
  for (const x of [-length * 0.33, length * 0.33])
    for (const side of [-1, 1]) {
      parts.add(
        "cylinder",
        [x, 0.049, side * 0.167],
        [0.073, 0.034, 0.073],
        "#303d3c",
        "stone",
        [Math.PI / 2, 0, 0],
      );
      parts.add(
        "cylinder",
        [x, 0.049, side * 0.19],
        [0.034, 0.011, 0.034],
        "#a6afa4",
        "metal",
        [Math.PI / 2, 0, 0],
      );
    }
  for (const side of [-1, 1])
    parts.box(
      [length / 2 + 0.006, 0.12, side * 0.11],
      [0.008, 0.035, 0.068],
      "#d8cf9f",
      "warm",
    );
  return parts.finish(isBus ? "electric-city-bus" : "car");
}

function river(resources: Resources) {
  const size = 128,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2,
        v = (y / size) * Math.PI * 2;
      const nx =
          Math.sin(u * 5 + Math.sin(v * 2)) * 0.23 +
          Math.sin(v * 7 + u * 3) * 0.12,
        ny = Math.cos(v * 4 + Math.sin(u * 3)) * 0.12;
      const index = (y * size + x) * 4;
      data[index] = Math.round((nx + 1) * 127.5);
      data[index + 1] = Math.round((ny + 1) * 127.5);
      data[index + 2] = 249;
      data[index + 3] = 255;
    }
  const normal = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(10, 2);
  normal.needsUpdate = true;
  normal.magFilter = THREE.LinearFilter;
  normal.minFilter = THREE.LinearFilter;
  resources.textures.add(normal);
  const water = new THREE.Mesh(
    resources.geometry(new THREE.PlaneGeometry(14.9, 2.1)),
    resources.material(
      new THREE.MeshStandardMaterial({
        color: "#39646c",
        metalness: 0.36,
        roughness: 0.32,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.31, 0.31),
      }),
    ),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.281, 2.55);
  water.receiveShadow = true;
  water.name = "procedural-river-surface";
  return water;
}

function bridge(resources: Resources, parts: Parts) {
  const group = new THREE.Group();
  group.name = "two-arch-limestone-bridge";
  const profile = new THREE.Shape();
  profile.moveTo(-1.28, 0.27);
  profile.lineTo(-1.08, 0.27);
  profile.quadraticCurveTo(-0.61, 1.03, -0.14, 0.27);
  profile.lineTo(0.14, 0.27);
  profile.quadraticCurveTo(0.61, 1.03, 1.08, 0.27);
  profile.lineTo(1.28, 0.27);
  profile.lineTo(1.28, 0.83);
  profile.lineTo(-1.28, 0.83);
  profile.closePath();
  const shape = resources.geometry(
    new THREE.ExtrudeGeometry(profile, {
      depth: 0.095,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.013,
      bevelThickness: 0.01,
      curveSegments: 16,
    }),
  );
  const material = resources.material(
    new THREE.MeshStandardMaterial({ color: "#bbb9aa", roughness: 0.89 }),
  );
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(shape, material);
    wall.rotation.y = Math.PI / 2;
    wall.position.set(2.4 + side * 0.54, 0, 2.55);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    parts.box(
      [2.4 + side * 0.54, 1.043, 2.55],
      [0.025, 0.028, 2.56],
      "#53665f",
      "metal",
    );
    parts.box(
      [2.4 + side * 0.54, 0.957, 2.55],
      [0.016, 0.018, 2.56],
      "#75847a",
      "metal",
    );
    for (let i = 0; i < 17; i++)
      parts.box(
        [2.4 + side * 0.54, 0.955, 1.29 + i * 0.157],
        [0.02, 0.18, 0.02],
        "#5f716a",
        "metal",
      );
    for (let i = 0; i < 14; i++)
      parts.box(
        [2.4 + side * 0.597, 0.765, 1.32 + i * 0.18],
        [0.008, 0.102, 0.009],
        "#a0a594",
      );
  }
  parts.box([2.4, 0.823, 2.55], [1.15, 0.075, 2.64], "#d0cbbd");
  for (const side of [-1, 1])
    for (let i = 0; i < 5; i++) {
      const height = 0.08 + i * 0.075;
      parts.box(
        [2.4, 0.37 + height / 2, 2.55 + side * (1.9 - i * 0.13)],
        [1.14, height, 0.16],
        "#c3c1b2",
      );
    }
  for (const z of [1.39, 3.72])
    for (const x of [1.85, 2.95]) {
      parts.box([x, 0.93, z], [0.12, 0.24, 0.12], "#c9c5b7");
      lamp(parts, x, z, 1.05, x > 2.4 ? -1 : 1);
    }
  person(parts, 2.17, 2.24, 8, 0.864);
  person(parts, 2.55, 3.03, 12, 0.864);
  return group;
}

export function createCityModel() {
  const resources = new Resources(),
    parts = new Parts(resources),
    root = new THREE.Group();
  root.name = "Sevens-authored-city-miniature";
  parts.box([0, -0.045, 0], [15, 0.46, 10.2], "#b4b7a7");
  parts.box([0, -0.297, 0], [14.92, 0.044, 10.12], "#77897d");
  parts.box([0, 0.224, -1.77], [14.94, 0.085, 6.64], pavement);
  parts.box([0, 0.285, 4.36], [14.94, 0.17, 1.49], "#b5b6a5");
  parts.box([0, 0.318, 0.96], [14.94, 0.104, 0.86], "#babcae");
  parts.box([0, 0.279, -1.35], [14.94, 0.048, 1.03], "#59615e");
  parts.box([2.4, 0.279, -2.52], [1.06, 0.047, 4.95], "#59615e");
  for (const dz of [-0.485, 0.485])
    parts.box([0, 0.307, -1.35 + dz], [14.9, 0.004, 0.018], "#a3aa96");
  for (let i = 0; i < 23; i++)
    if (i < 14 || i > 15)
      parts.box(
        [-7.04 + i * 0.635, 0.309, -1.35],
        [0.28, 0.006, 0.025],
        "#c8c9b6",
      );
  for (let i = 0; i < 6; i++)
    parts.box([1.97 + i * 0.17, 0.312, -0.73], [0.075, 0.006, 0.32], "#d8d6c7");
  for (let i = 0; i < 6; i++)
    parts.box([3.12, 0.312, -1.77 + i * 0.16], [0.28, 0.006, 0.075], "#d8d6c7");
  for (const z of [-1.96, -0.73, 1.25, 3.82])
    parts.box([0, 0.326, z], [14.94, 0.086, 0.23], "#cfccbc");
  for (const x of [1.72, 3.08])
    parts.box([x, 0.322, -3.34], [0.18, 0.078, 3.43], "#c9c8b8");
  const buildings: [number, number, number, number, number][] = [
    [-5.4, -3.37, 1.42, 1.63, 2.12],
    [-2.98, -3.4, 1.73, 1.71, 3.48],
    [-0.37, -3.55, 1.78, 1.7, 2.62],
    [4.48, -3.53, 1.65, 1.64, 3.74],
    [6.42, -3.51, 1.1, 1.45, 2.01],
    [-5.47, 0.07, 1.64, 1.09, 1.19],
    [-2.7, -0.02, 1.57, 1.25, 2.49],
    [0.26, -0.04, 1.5, 1.23, 1.46],
    [4.88, -0.04, 2.08, 1.24, 1.55],
    [-4.3, 4.44, 1.25, 0.76, 0.74],
    [5.77, 4.42, 1.2, 0.8, 0.82],
  ];
  buildings.forEach((spec, index) => building(parts, spec, index));
  const gardens: [number, number, number, number][] = [
    [-6.75, -3.2, 0.55, 2.3],
    [-4.16, -3.26, 0.53, 2.4],
    [-1.59, -3.54, 0.52, 2.2],
    [1.12, -3.48, 0.45, 2.4],
    [-6.1, 0.83, 1.75, 0.38],
    [-0.98, 0.36, 0.53, 1.3],
    [6.5, 0.26, 0.82, 1.43],
    [-1.55, 4.44, 3.25, 0.72],
    [0.74, 0.85, 1.33, 0.43],
  ];
  gardens.forEach(([x, z, w, d]) => {
    parts.box([x, 0.334, z], [w + 0.045, 0.09, d + 0.045], "#9fa88e");
    parts.box([x, 0.387, z], [w, 0.024, d], "#859174");
  });
  const trees: [number, number][] = [
    [-6.84, -4.28],
    [-6.71, -3.25],
    [-6.68, -2.34],
    [-4.19, -4.24],
    [-4.18, -3.28],
    [-4.08, -2.3],
    [-1.6, -4.4],
    [-1.58, -2.46],
    [0.96, -4.37],
    [1.13, -2.55],
    [3.4, -4.5],
    [3.47, -2.34],
    [6.65, -2.17],
    [-6.68, 0.29],
    [-6.49, 0.98],
    [-4.58, 0.91],
    [-3.88, 0.92],
    [-1.29, 0.8],
    [-1.1, -0.04],
    [1.25, 0.55],
    [0.8, 1.07],
    [3.44, 0.42],
    [3.66, 1.02],
    [6.51, 0.84],
    [6.79, -0.24],
    [-6.62, 4.25],
    [-5.82, 4.45],
    [-3.3, 4.5],
    [-2.61, 4.33],
    [-1.8, 4.58],
    [-0.81, 4.27],
    [0.03, 4.63],
    [0.79, 4.35],
    [3.52, 4.34],
    [4.23, 4.5],
    [6.95, 4.43],
  ];
  trees.forEach(([x, z], i) =>
    tree(parts, x, z, i + 3, 0.77 + noise(i * 9) * 0.28),
  );
  for (let i = 0; i < 12; i++)
    parts.sphere(
      [-6.7 + i * 0.27, 0.446, 4.98],
      [0.16, 0.115, 0.14],
      i % 2 ? "#6a7b59" : "#788463",
    );
  for (const z of [1.49, 3.62]) {
    parts.box([0, 0.306, z], [14.96, 0.24, 0.16], "#a7ad9f");
    parts.box([0, 0.444, z], [14.99, 0.055, 0.24], "#d0cbbc");
    for (let row = 0; row < 2; row++) {
      parts.box(
        [0, 0.263 + row * 0.087, z + (z < 2 ? 0.083 : -0.083)],
        [14.9, 0.008, 0.007],
        "#8b968b",
      );
      for (let tile = 0; tile < 47; tile++)
        parts.box(
          [
            -7.39 + tile * 0.318 + (row % 2) * 0.12,
            0.299 + row * 0.087,
            z + (z < 2 ? 0.083 : -0.083),
          ],
          [0.008, 0.077, 0.007],
          "#8e988d",
        );
    }
    for (let i = 0; i < 72; i++) {
      const x = -7.3 + i * 0.204;
      if (x > 1.78 && x < 3.01) continue;
      parts.box([x, 0.555, z], [0.018, 0.2, 0.018], "#576f67", "metal");
    }
    for (const [center, width] of [
      [-2.8, 8.87],
      [5.24, 4.45],
    ] as [number, number][]) {
      parts.box([center, 0.66, z], [width, 0.024, 0.025], "#6a7e73", "metal");
      parts.box([center, 0.565, z], [width, 0.014, 0.014], "#6a7e73", "metal");
    }
  }
  for (const x of [-6.45, -4.1, -1.35, 1.1, 3.7, 6.5]) {
    lamp(parts, x, -0.65);
    lamp(parts, x, 3.94, 0.37, -1);
  }
  for (const x of [-5.75, -3.85, -0.9, 4.5, 6.4]) lamp(parts, x, 1.24);
  for (const [x, z] of [
    [-5.25, 1.05],
    [-0.02, 1.03],
    [4.93, 1.02],
    [-2.22, 4.01],
    [0.21, 4.06],
    [4.15, 4.04],
  ] as [number, number][])
    bench(parts, x, z);
  const people: [number, number][] = [
    [-6.1, -0.65],
    [-5.87, -0.68],
    [-3.95, -0.69],
    [-3.74, -0.67],
    [-1.88, -0.68],
    [0.97, -0.62],
    [3.33, -0.58],
    [3.46, -0.6],
    [5.8, -0.65],
    [-5.86, 1.03],
    [-3.91, 1.12],
    [-0.71, 1.09],
    [0.87, 1.03],
    [4.84, 1.08],
    [5.58, 1.03],
    [-5.19, 3.98],
    [-3.57, 3.96],
    [-1.2, 4.04],
    [-1.02, 4.09],
    [0.53, 3.98],
    [3.56, 4],
    [4.8, 4.06],
  ];
  people.forEach(([x, z], i) => person(parts, x, z, i));
  root.add(river(resources));
  root.add(bridge(resources, parts));
  root.add(parts.finish("architecture-and-landscape"));
  const bus = vehicle(resources, true, "#b86b43");
  bus.position.set(0.1, 0.327, -1.6);
  root.add(bus);
  const cars: [number, number, string][] = [
    [-5.4, -1.12, "#556c70"],
    [0.2, -1.12, "#d3d0bd"],
    [5.9, -1.62, "#6c7770"],
  ];
  cars.forEach(([x, z, color]) => {
    const car = vehicle(resources, false, color);
    car.position.set(x, 0.327, z);
    if (z === -1.12) car.rotation.y = Math.PI;
    root.add(car);
  });
  let drawBatches = 0,
    instanceCount = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) drawBatches++;
    if (object instanceof THREE.InstancedMesh) instanceCount += object.count;
  });
  root.userData.modelStats = {
    drawBatches,
    instanceCount,
    source: "authored procedural geometry",
  };
  return { root, bus, dispose: () => resources.dispose(root) };
}
