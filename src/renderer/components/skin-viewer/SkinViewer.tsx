import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { PlayerModel, type SkinModel, type AnimationType } from "./playerModel";

export interface SkinViewerProps {
  /** Skin texture as a data URL, or null to show the default launcher skin. */
  dataUrl: string | null;
  model: SkinModel;
  animationEnabled: boolean;
  animationType: AnimationType;
  className?: string;
}

export interface SkinViewerHandle {
  /** Resets camera rotation, zoom and the model pose. */
  resetView(): void;
}

const TARGET_Y = 16;
const DEFAULT_DISTANCE = 58;
const MIN_DISTANCE = 30;
const MAX_DISTANCE = 110;

/** Interactive 3D Minecraft skin viewer built on three.js. Owns the WebGL canvas, a
 * player model, custom orbit controls (drag to rotate, wheel to zoom, with damping) and
 * the render loop. Rendering is paused while nothing is moving to save power. */
export const SkinViewer = forwardRef<SkinViewerHandle, SkinViewerProps>(function SkinViewer(
  { dataUrl, model, animationEnabled, animationType, className },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<PlayerModel | null>(null);
  const stateRef = useRef({
    yaw: 0.6,
    pitch: 0.32,
    distance: DEFAULT_DISTANCE,
    targetYaw: 0.6,
    targetPitch: 0.32,
    targetDistance: DEFAULT_DISTANCE,
  });
  const animRef = useRef({ enabled: animationEnabled, type: animationType });
  const loadIdRef = useRef(0);
  const mountedRef = useRef(false);
  const dataUrlRef = useRef(dataUrl);
  dataUrlRef.current = dataUrl;
  const [loading, setLoading] = useState(true);

  useImperativeHandle(ref, () => ({
    resetView() {
      const s = stateRef.current;
      s.targetYaw = 0.6;
      s.targetPitch = 0.32;
      s.targetDistance = DEFAULT_DISTANCE;
      modelRef.current?.resetPose();
    },
  }));

  useEffect(() => {
    animRef.current = { enabled: animationEnabled, type: animationType };
    if (modelRef.current) {
      modelRef.current.animationEnabled = animationEnabled;
      modelRef.current.animationType = animationType;
    }
  }, [animationEnabled, animationType]);

  useEffect(() => {
    modelRef.current?.setModel(model);
  }, [model]);

  useEffect(() => {
    // The mount effect (below) owns the first skin load via dataUrlRef; this effect only
    // reacts to subsequent dataUrl changes.
    if (!mountedRef.current) return;
    setLoading(true);
    const model = modelRef.current;
    if (!model) return;
    const loadId = ++loadIdRef.current;
    model.loadSkin(dataUrl).then(() => {
      if (loadId === loadIdRef.current) setLoading(false);
    });
    return () => {
      loadIdRef.current++;
    };
  }, [dataUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement!;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(24, 40, 32);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-30, 12, -36);
    scene.add(ambient, key, fill);

    const player = new PlayerModel(modelRef.current?.model ?? model);
    modelRef.current = player;
    player.animationEnabled = animRef.current.enabled;
    player.animationType = animRef.current.type;
    scene.add(player.root);

    mountedRef.current = true;
    setLoading(true);
    const loadId = ++loadIdRef.current;
    player.loadSkin(dataUrlRef.current).then(() => {
      if (loadId === loadIdRef.current) setLoading(false);
    });

    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const cameraState = stateRef.current;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let needsRender = true;
    let lastTime = performance.now();

    const applyCamera = () => {
      const { yaw, pitch, distance } = cameraState;
      camera.position.set(
        distance * Math.cos(pitch) * Math.sin(yaw),
        distance * Math.sin(pitch) + TARGET_Y,
        distance * Math.cos(pitch) * Math.cos(yaw)
      );
      camera.lookAt(0, TARGET_Y, 0);
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("cursor-grabbing");
      needsRender = true;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      cameraState.targetYaw -= dx * 0.005;
      cameraState.targetPitch = THREE.MathUtils.clamp(
        cameraState.targetPitch + dy * 0.005,
        -1.3,
        1.3
      );
      needsRender = true;
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      canvas.classList.remove("cursor-grabbing");
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraState.targetDistance = THREE.MathUtils.clamp(
        cameraState.targetDistance + e.deltaY * 0.01,
        MIN_DISTANCE,
        MAX_DISTANCE
      );
      needsRender = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") {
        cameraState.targetYaw = 0.6;
        cameraState.targetPitch = 0.32;
        cameraState.targetDistance = DEFAULT_DISTANCE;
        player.resetPose();
        needsRender = true;
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);

    let rafId = 0;
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const animating = animRef.current.enabled;
      if (animating) {
        player.update(dt);
        needsRender = true;
      }

      const s = cameraState;
      const damp = 1 - Math.pow(0.001, dt);
      const yawDelta = s.targetYaw - s.yaw;
      const pitchDelta = s.targetPitch - s.pitch;
      const distDelta = s.targetDistance - s.distance;
      if (Math.abs(yawDelta) > 1e-4 || Math.abs(pitchDelta) > 1e-4 || Math.abs(distDelta) > 1e-4) {
        s.yaw += yawDelta * damp;
        s.pitch += pitchDelta * damp;
        s.distance += distDelta * damp;
        needsRender = true;
      }

      if (needsRender) {
        needsRender = false;
        applyCamera();
        renderer.render(scene, camera);
      }
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      mountedRef.current = false;
      loadIdRef.current++;
      cancelAnimationFrame(rafId);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      player.dispose();
      renderer.dispose();
      if (modelRef.current === player) modelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className={"block h-full w-full cursor-grab touch-none " + (className ?? "")} />
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-noxara-border border-t-noxara-text" />
        </div>
      )}
    </div>
  );
});