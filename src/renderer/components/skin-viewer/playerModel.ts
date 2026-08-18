import * as THREE from "three";

export type SkinModel = "classic" | "slim";
export type AnimationType = "idle" | "walk";

/** Origin of a body part in the 64x64 skin atlas plus its box dimensions. The atlas
 * follows the standard Minecraft layout: `width`/`height`/`depth` are the box size in
 * model units AND the pixel size of the corresponding atlas region. */
interface UVRegion {
  u: number;
  v: number;
  width: number;
  height: number;
  depth: number;
}

const HEAD: UVRegion = { u: 0, v: 0, width: 8, height: 8, depth: 8 };
const HAT: UVRegion = { u: 32, v: 0, width: 8, height: 8, depth: 8 };
const BODY: UVRegion = { u: 16, v: 16, width: 8, height: 12, depth: 4 };
const JACKET: UVRegion = { u: 16, v: 32, width: 8, height: 12, depth: 4 };
const RIGHT_ARM: UVRegion = { u: 40, v: 16, width: 4, height: 12, depth: 4 };
const RIGHT_SLEEVE: UVRegion = { u: 40, v: 32, width: 4, height: 12, depth: 4 };
const LEFT_ARM: UVRegion = { u: 32, v: 48, width: 4, height: 12, depth: 4 };
const LEFT_SLEEVE: UVRegion = { u: 48, v: 48, width: 4, height: 12, depth: 4 };
const RIGHT_LEG: UVRegion = { u: 0, v: 16, width: 4, height: 12, depth: 4 };
const RIGHT_PANT: UVRegion = { u: 0, v: 32, width: 4, height: 12, depth: 4 };
const LEFT_LEG: UVRegion = { u: 16, v: 48, width: 4, height: 12, depth: 4 };
const LEFT_PANT: UVRegion = { u: 0, v: 48, width: 4, height: 12, depth: 4 };

/**
 * Maps a THREE.BoxGeometry's 6 faces onto the corresponding Minecraft atlas region.
 * This is the exact mapping used by skinview3d (MIT): the standard box is built with
 * each face covering its part of the "unfolded cube", and the per-face vertex orders are
 * fixed up so every face is upright and correctly mirrored when viewed from outside.
 * `flipU` mirrors every face horizontally — used to build the left limbs of legacy
 * 64x32 skins from the right-limb regions (mirroring them across the body plane).
 */
function setSkinUVs(geo: THREE.BufferGeometry, region: UVRegion, flipU = false): void {
  const { u, v, width, height, depth } = region;
  const toFaceVertices = (x1: number, y1: number, x2: number, y2: number) => [
    new THREE.Vector2(x1 / 64, 1 - y2 / 64),
    new THREE.Vector2(x2 / 64, 1 - y2 / 64),
    new THREE.Vector2(x2 / 64, 1 - y1 / 64),
    new THREE.Vector2(x1 / 64, 1 - y1 / 64),
  ];

  const top = toFaceVertices(u + depth, v, u + width + depth, v + depth);
  const bottom = toFaceVertices(u + width + depth, v, u + width * 2 + depth, v + depth);
  const left = toFaceVertices(u, v + depth, u + depth, v + depth + height);
  const front = toFaceVertices(u + depth, v + depth, u + width + depth, v + depth + height);
  const right = toFaceVertices(u + width + depth, v + depth, u + width + depth * 2, v + depth + height);
  const back = toFaceVertices(u + width + depth * 2, v + depth, u + width * 2 + depth * 2, v + depth + height);

  // BoxGeometry face order is +X, -X, +Y, -Y, +Z, -Z with 4 UVs per face (BL, BR, TR, TL).
  const uvRight = [right[3], right[2], right[0], right[1]];
  const uvLeft = [left[3], left[2], left[0], left[1]];
  const uvTop = [top[3], top[2], top[0], top[1]];
  const uvBottom = [bottom[0], bottom[1], bottom[3], bottom[2]];
  const uvFront = [front[3], front[2], front[0], front[1]];
  const uvBack = [back[3], back[2], back[0], back[1]];

  const data: number[] = [];
  for (const face of [uvRight, uvLeft, uvTop, uvBottom, uvFront, uvBack]) {
    for (const uv of face) {
      data.push(flipU ? 1 - uv.x : uv.x, uv.y);
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(data), 2));
}

function createBox(size: [number, number, number], region: UVRegion, flipU = false): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(...size);
  setSkinUVs(geo, region, flipU);
  return geo;
}

interface LimbSpec {
  base: UVRegion;
  outer: UVRegion;
  arm: boolean;
  right: boolean;
  /** Legacy 64x32 skins have no left-limb regions; the left limbs are mirrored from this. */
  legacyMirror: UVRegion;
}

interface PartRefs {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  outerMesh: THREE.Mesh;
}

/** A whole-body Minecraft player model: base layer + second (outer) layer, classic or
 * slim arms, legacy 64x32 handling, and idle/walk joint animation. Pure three.js — no
 * DOM access, safe to run on any frame. */
export class PlayerModel {
  readonly root = new THREE.Group();

  private readonly baseMaterial: THREE.MeshLambertMaterial;
  private readonly outerMaterial: THREE.MeshLambertMaterial;

  private readonly head: PartRefs;
  private readonly body: PartRefs;
  private readonly rightArm: PartRefs;
  private readonly leftArm: PartRefs;
  private readonly rightLeg: PartRefs;
  private readonly leftLeg: PartRefs;

  private readonly leftArmSpec: LimbSpec = {
    base: LEFT_ARM,
    outer: LEFT_SLEEVE,
    arm: true,
    right: false,
    legacyMirror: RIGHT_ARM,
  };
  private readonly leftLegSpec: LimbSpec = {
    base: LEFT_LEG,
    outer: LEFT_PANT,
    arm: false,
    right: false,
    legacyMirror: RIGHT_LEG,
  };
  private readonly rightArmSpec: LimbSpec = {
    base: RIGHT_ARM,
    outer: RIGHT_SLEEVE,
    arm: true,
    right: true,
    legacyMirror: RIGHT_ARM,
  };
  private readonly rightLegSpec: LimbSpec = {
    base: RIGHT_LEG,
    outer: RIGHT_PANT,
    arm: false,
    right: true,
    legacyMirror: RIGHT_LEG,
  };

  private texture: THREE.Texture | null = null;
  private modelType: SkinModel = "classic";
  private legacy = false;

  animationEnabled = true;
  animationType: AnimationType = "idle";
  private clock = 0;
  private disposed = false;

  constructor(model: SkinModel) {
    this.modelType = model;

    this.baseMaterial = new THREE.MeshLambertMaterial({ side: THREE.FrontSide });
    // Second layer must show partially-transparent pixels (hats, sleeves, jackets).
    // Matching skinview3d: DoubleSide + alphaTest so only visible pixels draw.
    this.outerMaterial = new THREE.MeshLambertMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 1e-5,
    });

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 24, 0);
    this.head = {
      pivot: headGroup,
      mesh: new THREE.Mesh(createBox([8, 8, 8], HEAD), this.baseMaterial),
      outerMesh: new THREE.Mesh(createBox([9, 9, 9], HAT), this.outerMaterial),
    };
    this.head.mesh.position.y = 4;
    this.head.outerMesh.position.y = 4;

    const bodyGroup = new THREE.Group();
    bodyGroup.position.set(0, 18, 0);
    this.body = {
      pivot: bodyGroup,
      mesh: new THREE.Mesh(createBox([8, 12, 4], BODY), this.baseMaterial),
      outerMesh: new THREE.Mesh(createBox([8.5, 12.5, 4.5], JACKET), this.outerMaterial),
    };

    this.rightArm = this.createLimb(this.rightArmSpec);
    this.leftArm = this.createLimb(this.leftArmSpec);
    this.rightLeg = this.createLimb(this.rightLegSpec);
    this.leftLeg = this.createLimb(this.leftLegSpec);

    this.root.add(headGroup, bodyGroup, this.rightArm.pivot, this.leftArm.pivot, this.rightLeg.pivot, this.leftLeg.pivot);
    headGroup.add(this.head.mesh, this.head.outerMesh);
    bodyGroup.add(this.body.mesh, this.body.outerMesh);

    void this.loadSkin(null);
  }

  private createLimb(spec: LimbSpec): PartRefs {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.baseMaterial);
    const outerMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.outerMaterial);
    pivot.add(mesh, outerMesh);
    this.rebuildLimb({ pivot, mesh, outerMesh }, spec);
    return { pivot, mesh, outerMesh };
  }

  /** (Re)builds a limb's geometry, position and outer layer for the current model type
   * and legacy flag. Called on construction, on model switch and on skin load. */
  private rebuildLimb(part: PartRefs, spec: LimbSpec): void {
    const width = spec.arm ? (this.modelType === "slim" ? 3 : 4) : 4;
    const gap = spec.arm ? (this.modelType === "slim" ? 5.5 : 6) : 2;
    const height = spec.base.height;

    part.pivot.position.set(spec.right ? gap : -gap, spec.arm ? 24 : 12, 0);

    const useMirror = !spec.right && this.legacy;
    const baseRegion = useMirror ? { ...spec.legacyMirror, width } : { ...spec.base, width };
    part.mesh.geometry.dispose();
    part.mesh.geometry = createBox([width, height, 4], baseRegion, useMirror);
    part.mesh.position.y = -height / 2;

    if (this.legacy) {
      part.outerMesh.visible = false;
    } else {
      part.outerMesh.visible = true;
      part.outerMesh.geometry.dispose();
      part.outerMesh.geometry = createBox([width + 0.5, height + 0.5, 4.5], { ...spec.outer, width });
      part.outerMesh.position.y = -(height + 0.5) / 2;
    }
  }

  /** Current body model type (classic = 4px arms, slim = 3px arms). */
  get model(): SkinModel {
    return this.modelType;
  }

  setModel(model: SkinModel): void {
    if (model === this.modelType) return;
    this.modelType = model;
    this.rebuildLimb(this.rightArm, this.rightArmSpec);
    this.rebuildLimb(this.leftArm, this.leftArmSpec);
    this.rebuildLimb(this.rightLeg, this.rightLegSpec);
    this.rebuildLimb(this.leftLeg, this.leftLegSpec);
  }

  /** Loads a skin texture (data URL). Passing null uses the launcher's default skin.
   * Resolves with the detected legacy flag; a corrupt/unreadable image falls back to the
   * default skin instead (never throws). */
  async loadSkin(dataUrl: string | null): Promise<{ legacy: boolean }> {
    if (dataUrl) {
      const image = await loadImage(dataUrl).catch(() => null);
      if (this.disposed) return { legacy: false };

      if (image) {
        this.setTexture(createTextureFromImage(image), image.naturalHeight === 32);
        return { legacy: image.naturalHeight === 32 };
      }
    }
    this.setTexture(createDefaultTexture(), false);
    return { legacy: false };
  }

  private setTexture(texture: THREE.Texture, legacy: boolean): void {
    if (this.texture) this.texture.dispose();
    this.texture = texture;
    this.baseMaterial.map = texture;
    this.baseMaterial.needsUpdate = true;
    this.outerMaterial.map = texture;
    this.outerMaterial.needsUpdate = true;

    if (legacy !== this.legacy) {
      this.legacy = legacy;
      // Legacy 64x32 skins have no left-limb regions (left limbs are mirrored from the
      // right) and no body/limb second layer — rebuild every limb so the outer meshes
      // are hidden (the head hat layer at rows 0-16 still applies and stays visible).
      this.rebuildLimb(this.rightArm, this.rightArmSpec);
      this.rebuildLimb(this.leftArm, this.leftArmSpec);
      this.rebuildLimb(this.rightLeg, this.rightLegSpec);
      this.rebuildLimb(this.leftLeg, this.leftLegSpec);
    }
  }

  resetPose(): void {
    this.head.pivot.rotation.set(0, 0, 0);
    this.body.pivot.rotation.set(0, 0, 0);
    this.body.pivot.scale.set(1, 1, 1);
    this.rightArm.pivot.rotation.set(0, 0, 0);
    this.leftArm.pivot.rotation.set(0, 0, 0);
    this.rightLeg.pivot.rotation.set(0, 0, 0);
    this.leftLeg.pivot.rotation.set(0, 0, 0);
    this.root.position.y = 0;
  }

  /** Advances the animation clock. Call once per frame with a dt in seconds. */
  update(dt: number): void {
    if (!this.animationEnabled) {
      this.resetPose();
      return;
    }

    this.clock += dt;
    const t = this.clock;

    if (this.animationType === "walk") {
      const phase = t * 3.2;
      const swing = Math.sin(phase) * 0.6;
      this.leftArm.pivot.rotation.x = swing;
      this.rightArm.pivot.rotation.x = -swing;
      this.rightLeg.pivot.rotation.x = swing;
      this.leftLeg.pivot.rotation.x = -swing;
      this.body.pivot.rotation.x = Math.sin(phase * 0.5) * 0.05;
      this.root.position.y = Math.abs(Math.sin(phase)) * 0.12;
      this.head.pivot.rotation.x = -swing * 0.25;
    } else {
      const breathe = Math.sin(t * 1.4);
      this.body.pivot.scale.set(1 + breathe * 0.012, 1 - breathe * 0.02, 1);
      const sway = Math.sin(t * 1.1) * 0.035;
      this.leftArm.pivot.rotation.x = sway;
      this.rightArm.pivot.rotation.x = -sway;
      this.leftLeg.pivot.rotation.x = sway * 0.5;
      this.rightLeg.pivot.rotation.x = -sway * 0.5;
      this.head.pivot.rotation.x = Math.sin(t * 0.9) * 0.02;
      this.root.position.y = Math.sin(t * 1.1) * 0.02;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.baseMaterial.dispose();
    this.outerMaterial.dispose();
    if (this.texture) this.texture.dispose();
  }
}

// Note: PlayerModel keeps all four limb specs as instance fields.

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode skin image."));
    img.src = dataUrl;
  });
}

function createTextureFromImage(image: HTMLImageElement): THREE.Texture {
  const texture = new THREE.Texture(image);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createDefaultTexture(): THREE.Texture {
  const canvas = makeDefaultSkinCanvas();
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Builds a fully white 64x64 skin so the model always has a readable (and, per the
 * product requirement, neutral) placeholder when the account/stored skin is missing or
 * unreadable. Every pixel is opaque so both the base layer and the second (outer)
 * layer render as solid white. */
function makeDefaultSkinCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}
