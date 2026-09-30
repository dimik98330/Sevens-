"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createCityModel } from "./city-model";

const nodes = [
  new THREE.Vector3(-2.98, 4.12, -3.4),
  new THREE.Vector3(4.88, 2.17, -0.04),
  new THREE.Vector3(-1.29, 1.91, 0.8),
];

function Connection({ a, b }: { a: THREE.Vector3; b: THREE.Vector3 }) {
  const geometry = useMemo(
    () =>
      new THREE.BufferGeometry().setFromPoints(
        new THREE.QuadraticBezierCurve3(
          a,
          new THREE.Vector3(
            (a.x + b.x) / 2,
            Math.max(a.y, b.y) + 0.47,
            (a.z + b.z) / 2,
          ),
          b,
        ).getPoints(64),
      ),
    [a, b],
  );
  const line = useMemo(() => {
    const object = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({
        color: "#ad8e69",
        dashSize: 0.085,
        gapSize: 0.055,
        transparent: true,
        opacity: 0.52,
      }),
    );
    object.computeLineDistances();
    return object;
  }, [geometry]);
  useEffect(
    () => () => {
      geometry.dispose();
      line.material.dispose();
    },
    [geometry, line],
  );
  return <primitive object={line} dispose={null} />;
}

function City({
  active,
  reduced,
  onSelect,
}: {
  active: number;
  reduced: boolean;
  onSelect: (n: number) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const model = useMemo(createCityModel, []);
  const { invalidate, viewport } = useThree();
  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => invalidate(), [active, invalidate]);
  useFrame(({ pointer, clock }, delta) => {
    if (!reduced) {
      if (group.current)
        group.current.rotation.y = THREE.MathUtils.damp(
          group.current.rotation.y,
          pointer.x * 0.035,
          3,
          delta,
        );
      model.bus.position.x = Math.sin(clock.elapsedTime * 0.1) * 3.8;
    }
  });
  return (
    <group
      ref={group}
      scale={Math.min(viewport.width / 17.7, viewport.height / 12.4, 0.98)}
    >
      <primitive object={model.root} dispose={null} />
      <Connection a={nodes[0]!} b={nodes[1]!} />
      <Connection a={nodes[1]!} b={nodes[2]!} />
      {nodes.map((position, i) => (
        <group
          key={i}
          position={position}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(i);
          }}
        >
          <mesh>
            <sphereGeometry args={[active === i ? 0.11 : 0.068, 16, 12]} />
            <meshStandardMaterial
              color={active === i ? "#d6a06c" : "#aebe9e"}
              emissive={active === i ? "#9c602e" : "#55785c"}
              emissiveIntensity={0.5}
              roughness={0.48}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[active === i ? 0.24 : 0.17, 0.007, 6, 40]} />
            <meshBasicMaterial color="#b7946b" transparent opacity={0.75} />
          </mesh>
        </group>
      ))}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.328, 0]}
        receiveShadow
      >
        <planeGeometry args={[23, 18]} />
        <shadowMaterial transparent opacity={0.13} />
      </mesh>
    </group>
  );
}

function Ready({
  onReady,
  onError,
}: {
  onReady: () => void;
  onError: () => void;
}) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("webglcontextlost", onError, { once: true });
    onReady();
    return () => canvas.removeEventListener("webglcontextlost", onError);
  }, [gl, onReady, onError]);
  return null;
}

export default function CityCanvas({
  active,
  onSelect,
  running,
  reduced,
  onReady,
  onError,
}: {
  active: number;
  onSelect: (n: number) => void;
  running: boolean;
  reduced: boolean;
  onReady: () => void;
  onError: () => void;
}) {
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.35]}
      frameloop={running && !reduced ? "always" : "demand"}
      orthographic
      camera={{ position: [13, 12, 16], zoom: 43, near: 0.1, far: 120 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      onCreated={({ gl, camera }) => {
        camera.lookAt(0, 0.85, 0);
        gl.setClearColor(0x000000, 0);
        gl.toneMappingExposure = 1.03;
      }}
    >
      <ambientLight intensity={0.32} />
      <hemisphereLight args={["#ede9df", "#5e705e", 1.25]} />
      <directionalLight
        position={[-7, 14, 8]}
        intensity={2.65}
        color="#ffe6c2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={0.5}
        shadow-camera-far={42}
        shadow-bias={-0.00025}
        shadow-normalBias={0.024}
        shadow-radius={2}
      />
      <directionalLight
        position={[8, 7, -9]}
        intensity={1.05}
        color="#b9ced9"
      />
      <City active={active} reduced={reduced} onSelect={onSelect} />
      <Ready onReady={onReady} onError={onError} />
    </Canvas>
  );
}
