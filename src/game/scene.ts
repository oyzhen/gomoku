import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GameLoop } from "./engine";
import { boardFromMoves, forbiddenReason, indexOf } from "./rules";
import { THEMES, type BoardTheme } from "./themes";
import { BLACK, BOARD_SIZE, EMPTY, WHITE, type Move, type Player, type Point, type RuleSet, type ThemeId } from "./types";

const CELL = 0.82;
const BOARD_SPAN = CELL * (BOARD_SIZE - 1);
const BOARD_WIDTH = BOARD_SPAN + 1.5;
const STONE_RADIUS = 0.35;
const MAX_STONES = BOARD_SIZE * BOARD_SIZE;

interface SceneOptions {
  onCell: (point: Point) => void;
  canPlace: (point: Point) => boolean;
}

interface PerformanceMetrics {
  calls: number;
  triangles: number;
  stones: number;
  fps: number;
  renderer: string;
}

export class BoardScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private loop: GameLoop;
  private boardTop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private boardBase: THREE.Mesh<RoundedBoxGeometry, THREE.MeshStandardMaterial>;
  private boardFrame: THREE.Mesh<RoundedBoxGeometry, THREE.MeshStandardMaterial>;
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private black: THREE.InstancedMesh;
  private white: THREE.InstancedMesh;
  private stoneShadows: THREE.InstancedMesh;
  private hover: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private lastMarker: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private ripple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private forbidden: THREE.InstancedMesh;
  private winRings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>[] = [];
  private dummy = new THREE.Object3D();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private moves: Move[] = [];
  private theme: BoardTheme = THEMES.walnut;
  private currentPlayer: Player = BLACK;
  private interactive = false;
  private animationStart = 0;
  private animatedMove = -1;
  private animatedInstanceIndex = -1;
  private rippleStart = 0;
  private pointerDown = { x: 0, y: 0 };
  private disposed = false;
  private frames = 0;
  private fpsStarted = performance.now();
  private fps = 60;
  private rendererName = "WebGL";
  private viewScale = 1;

  constructor(private canvas: HTMLCanvasElement, private options: SceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
    this.camera.position.set(0, 17.5 * this.viewScale, 14.5 * this.viewScale);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.target.set(0, -0.1, 0);
    this.controls.minDistance = 10;
    this.controls.maxDistance = 24;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.28;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.7;

    this.scene.add(new THREE.HemisphereLight(0xfff3dd, 0x26313a, 1.55));
    const key = new THREE.DirectionalLight(0xffe6c4, 3.0);
    key.position.set(-5, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 35;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xa9c8ff, 1.25);
    rim.position.set(7, 6, -8);
    this.scene.add(rim);

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: this.theme.floor, roughness: 0.94, metalness: 0.02 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.66;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.boardFrame = new THREE.Mesh(new RoundedBoxGeometry(BOARD_WIDTH + 0.18, 0.42, BOARD_WIDTH + 0.18, 5, 0.13), new THREE.MeshStandardMaterial({ color: 0x2b190f, roughness: 0.5 }));
    this.boardFrame.position.y = -0.39;
    this.boardFrame.castShadow = true;
    this.boardFrame.receiveShadow = true;
    this.scene.add(this.boardFrame);
    this.boardBase = new THREE.Mesh(new RoundedBoxGeometry(BOARD_WIDTH, 0.55, BOARD_WIDTH, 5, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.02 }));
    this.boardBase.position.y = -0.28;
    this.boardBase.castShadow = true;
    this.boardBase.receiveShadow = true;
    this.scene.add(this.boardBase);
    this.boardTop = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_WIDTH - 0.05, BOARD_WIDTH - 0.05), new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.01 }));
    this.boardTop.rotation.x = -Math.PI / 2;
    this.boardTop.position.y = 0.008;
    this.boardTop.receiveShadow = true;
    this.scene.add(this.boardTop);

    const stoneGeometry = new THREE.SphereGeometry(STONE_RADIUS, 32, 20);
    const blackMaterial = new THREE.MeshPhysicalMaterial({ color: this.theme.black, roughness: 0.2, metalness: 0.08, clearcoat: 0.75, clearcoatRoughness: 0.18 });
    const whiteMaterial = new THREE.MeshPhysicalMaterial({ color: this.theme.white, roughness: 0.25, metalness: 0.01, clearcoat: 0.55, clearcoatRoughness: 0.22 });
    this.black = new THREE.InstancedMesh(stoneGeometry, blackMaterial, MAX_STONES);
    this.white = new THREE.InstancedMesh(stoneGeometry, whiteMaterial, MAX_STONES);
    for (const mesh of [this.black, this.white]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.scene.add(mesh);
    }

    const contactGeometry = new THREE.CircleGeometry(STONE_RADIUS * 1.08, 24);
    contactGeometry.rotateX(-Math.PI / 2);
    this.stoneShadows = new THREE.InstancedMesh(contactGeometry, new THREE.MeshBasicMaterial({ color: 0x080706, transparent: true, opacity: 0.24, depthWrite: false }), MAX_STONES);
    this.stoneShadows.count = 0;
    this.scene.add(this.stoneShadows);

    this.hover = new THREE.Mesh(stoneGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false, roughness: 0.35 }));
    this.hover.scale.y = 0.5;
    this.hover.visible = false;
    this.scene.add(this.hover);

    this.lastMarker = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 24), new THREE.MeshBasicMaterial({ color: this.theme.accent, depthTest: false }));
    this.lastMarker.rotation.x = Math.PI / 2;
    this.lastMarker.renderOrder = 4;
    this.lastMarker.visible = false;
    this.scene.add(this.lastMarker);
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.41, 48), new THREE.MeshBasicMaterial({ color: this.theme.accent, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.ripple.rotation.x = -Math.PI / 2;
    this.ripple.position.y = 0.035;
    this.scene.add(this.ripple);

    this.forbidden = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.014, 0.026), new THREE.MeshBasicMaterial({ color: 0xb64b43, transparent: true, opacity: 0.82 }), MAX_STONES * 2);
    this.forbidden.count = 0;
    this.scene.add(this.forbidden);
    const winGeometry = new THREE.TorusGeometry(0.385, 0.026, 8, 40);
    for (let i = 0; i < 7; i++) {
      const ring = new THREE.Mesh(winGeometry, new THREE.MeshStandardMaterial({ color: this.theme.accent, emissive: this.theme.accent, emissiveIntensity: 0.65, roughness: 0.3 }));
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      this.winRings.push(ring);
      this.scene.add(ring);
    }

    this.setTheme("walnut");
    this.bindEvents();
    this.resize();
    this.readRendererName();
    this.loop = new GameLoop({ update: () => this.update(), render: () => this.render() });
    this.loop.start();
    window.__gameMetrics = () => ({
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      stones: this.moves.length,
      fps: this.fps,
      renderer: this.rendererName,
    });
  }

  private readRendererName(): void {
    const gl = this.renderer.getContext();
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    this.rendererName = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }

  private bindEvents(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.interactive || Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 7) return;
    const point = this.eventPoint(event);
    if (point && this.options.canPlace(point)) this.options.onCell(point);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.interactive || event.buttons !== 0) {
      this.hover.visible = false;
      return;
    }
    const point = this.eventPoint(event);
    this.hover.visible = Boolean(point && this.options.canPlace(point));
    if (point) this.hover.position.set((point.col - 7) * CELL, 0.19, (point.row - 7) * CELL);
  };

  private onPointerLeave = (): void => {
    this.hover.visible = false;
  };

  private onVisibility = (): void => {
    if (document.hidden) this.loop.stop();
    else if (!this.disposed) this.loop.start();
  };

  private eventPoint(event: PointerEvent): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.boardTop, false)[0];
    if (!hit) return null;
    const col = Math.round(hit.point.x / CELL + 7);
    const row = Math.round(hit.point.z / CELL + 7);
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
    const dx = hit.point.x - (col - 7) * CELL;
    const dz = hit.point.z - (row - 7) * CELL;
    return Math.hypot(dx, dz) < CELL * 0.47 ? { row, col } : null;
  }

  private resize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    const nextScale = Math.max(1, 0.95 / this.camera.aspect);
    if (Math.abs(nextScale - this.viewScale) > 0.001) {
      this.camera.position.multiplyScalar(nextScale / this.viewScale);
      this.viewScale = nextScale;
      this.controls.minDistance = 10 * this.viewScale;
      this.controls.maxDistance = 30 * this.viewScale;
      this.camera.far = Math.max(120, this.viewScale * 90);
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.near = 28 * this.viewScale;
        this.scene.fog.far = 72 * this.viewScale;
      }
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private seeded(seed: number): () => number {
    return () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private boardTexture(theme: BoardTheme): THREE.CanvasTexture {
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const margin = 70;
    const step = (size - margin * 2) / 14;
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, theme.board);
    gradient.addColorStop(0.48, theme.board);
    gradient.addColorStop(1, theme.id === "walnut" ? "#b88346" : theme.board);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const random = this.seeded(theme.id.length * 7919 + 17);
    if (theme.id === "walnut") {
      for (let i = 0; i < 180; i++) {
        const y = random() * size;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= size; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.012 + random() * 3) * (2 + random() * 5));
        ctx.strokeStyle = `rgba(73,39,16,${0.018 + random() * 0.04})`;
        ctx.lineWidth = 0.6 + random() * 1.5;
        ctx.stroke();
      }
    } else if (theme.id === "cosmic") {
      for (let i = 0; i < 150; i++) {
        ctx.fillStyle = `rgba(190,211,255,${0.03 + random() * 0.13})`;
        ctx.beginPath();
        ctx.arc(random() * size, random() * size, 0.4 + random() * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (let i = 0; i < 80; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.012 + random() * 0.025})`;
        ctx.beginPath();
        ctx.arc(random() * size, random() * size, 20 + random() * 150, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < BOARD_SIZE; i++) {
      const p = margin + i * step;
      ctx.beginPath();
      ctx.moveTo(margin, p);
      ctx.lineTo(size - margin, p);
      ctx.moveTo(p, margin);
      ctx.lineTo(p, size - margin);
      ctx.stroke();
    }
    ctx.fillStyle = theme.grid;
    for (const [row, col] of [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]) {
      ctx.beginPath();
      ctx.arc(margin + col * step, margin + row * step, 5.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = theme.text;
    ctx.font = "500 18px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < BOARD_SIZE; i++) {
      const p = margin + i * step;
      const letter = String.fromCharCode(65 + i);
      ctx.fillText(letter, p, 31);
      ctx.fillText(letter, p, size - 31);
      ctx.fillText(String(i + 1), 30, p);
      ctx.fillText(String(i + 1), size - 30, p);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  setTheme(id: ThemeId): void {
    this.theme = THEMES[id];
    this.scene.background = new THREE.Color(this.theme.background);
    this.scene.fog = new THREE.Fog(this.theme.background, 28 * this.viewScale, 72 * this.viewScale);
    this.floor.material.color.setHex(this.theme.floor);
    this.boardBase.material.color.set(this.theme.board);
    this.boardFrame.material.color.setHex(this.theme.boardEdge);
    const old = this.boardTop.material.map;
    this.boardTop.material.map = this.boardTexture(this.theme);
    this.boardTop.material.needsUpdate = true;
    old?.dispose();
    (this.black.material as THREE.MeshPhysicalMaterial).color.setHex(this.theme.black);
    (this.white.material as THREE.MeshPhysicalMaterial).color.setHex(this.theme.white);
    this.lastMarker.material.color.set(this.theme.accent);
    this.ripple.material.color.set(this.theme.accent);
    for (const ring of this.winRings) {
      ring.material.color.set(this.theme.accent);
      ring.material.emissive.set(this.theme.accent);
    }
  }

  setInteractive(enabled: boolean): void {
    this.interactive = enabled;
    if (!enabled) this.hover.visible = false;
  }

  setTurn(player: Player): void {
    this.currentPlayer = player;
    this.hover.material.color.setHex(player === BLACK ? this.theme.black : this.theme.white);
  }

  setPosition(moves: Move[], rule: RuleSet, showForbidden: boolean, animateLatest = true): void {
    const previousLength = this.moves.length;
    this.moves = [...moves];
    this.animatedMove = animateLatest && moves.length > previousLength ? moves.length - 1 : -1;
    this.animationStart = performance.now();
    this.rebuildStones();
    this.updateForbidden(rule, showForbidden);
    this.lastMarker.visible = moves.length > 0;
    if (moves.length) {
      const last = moves[moves.length - 1];
      this.lastMarker.position.set((last.col - 7) * CELL, 0.385, (last.row - 7) * CELL);
      if (this.animatedMove >= 0) {
        this.ripple.position.x = (last.col - 7) * CELL;
        this.ripple.position.z = (last.row - 7) * CELL;
        this.rippleStart = performance.now();
      }
    }
  }

  setWinningLine(line: Point[] | null): void {
    for (let i = 0; i < this.winRings.length; i++) {
      const ring = this.winRings[i];
      ring.visible = Boolean(line && i < line.length);
      if (line && i < line.length) ring.position.set((line[i].col - 7) * CELL, 0.385, (line[i].row - 7) * CELL);
    }
  }

  private updateForbidden(rule: RuleSet, show: boolean): void {
    this.forbidden.count = 0;
    if (!show || rule !== "renju" || this.currentPlayer !== BLACK) return;
    const board = boardFromMoves(this.moves);
    let count = 0;
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[indexOf(row, col)] !== EMPTY || !forbiddenReason(board, row, col, BLACK, rule)) continue;
        for (const angle of [Math.PI / 4, -Math.PI / 4]) {
          this.dummy.position.set((col - 7) * CELL, 0.035, (row - 7) * CELL);
          this.dummy.rotation.set(0, angle, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          this.forbidden.setMatrixAt(count++, this.dummy.matrix);
        }
      }
    }
    this.forbidden.count = count;
    this.forbidden.instanceMatrix.needsUpdate = true;
  }

  private rebuildStones(): void {
    let blackCount = 0;
    let whiteCount = 0;
    for (let i = 0; i < this.moves.length; i++) {
      const move = this.moves[i];
      const scale = i === this.animatedMove ? 0.01 : 1;
      this.setStoneMatrix(move, scale);
      if (move.player === BLACK) {
        if (i === this.animatedMove) this.animatedInstanceIndex = blackCount;
        this.black.setMatrixAt(blackCount++, this.dummy.matrix);
      } else {
        if (i === this.animatedMove) this.animatedInstanceIndex = whiteCount;
        this.white.setMatrixAt(whiteCount++, this.dummy.matrix);
      }
      this.dummy.position.set((move.col - 7) * CELL, 0.024, (move.row - 7) * CELL);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.stoneShadows.setMatrixAt(i, this.dummy.matrix);
    }
    this.stoneShadows.count = this.moves.length;
    this.stoneShadows.instanceMatrix.needsUpdate = true;
    this.black.count = blackCount;
    this.white.count = whiteCount;
    this.black.instanceMatrix.needsUpdate = true;
    this.white.instanceMatrix.needsUpdate = true;
  }

  private setStoneMatrix(move: Move, scale: number): void {
    this.dummy.position.set((move.col - 7) * CELL, 0.185 + (1 - scale) * 0.45, (move.row - 7) * CELL);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(scale, scale * 0.5, scale);
    this.dummy.updateMatrix();
  }

  private update(): void {
    if (this.animatedMove >= 0) {
      const progress = Math.min(1, (performance.now() - this.animationStart) / 260);
      const eased = 1 - Math.pow(1 - progress, 3);
      const move = this.moves[this.animatedMove];
      if (move) {
        this.setStoneMatrix(move, Math.max(0.01, eased));
        const mesh = move.player === BLACK ? this.black : this.white;
        mesh.setMatrixAt(this.animatedInstanceIndex, this.dummy.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (progress >= 1) this.animatedMove = -1;
    }
    const rippleProgress = (performance.now() - this.rippleStart) / 520;
    if (rippleProgress >= 0 && rippleProgress < 1) {
      const scale = 1 + rippleProgress * 1.8;
      this.ripple.scale.setScalar(scale);
      this.ripple.material.opacity = (1 - rippleProgress) * 0.42;
    } else this.ripple.material.opacity = 0;
  }

  private render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    const now = performance.now();
    if (now - this.fpsStarted >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsStarted));
      this.frames = 0;
      this.fpsStarted = now;
    }
    window.__GAME_READY__ = true;
    window.__SCENE_READY__ = true;
  }

  cellScreen(point: Point): { x: number; y: number } {
    const vector = new THREE.Vector3((point.col - 7) * CELL, 0.02, (point.row - 7) * CELL).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (vector.x + 1) * rect.width / 2, y: rect.top + (1 - vector.y) * rect.height / 2 };
  }

  resetView(): void {
    this.camera.position.set(0, 17.5 * this.viewScale, 14.5 * this.viewScale);
    this.controls.target.set(0, -0.1, 0);
    this.controls.update();
  }

  topView(): void {
    this.camera.position.set(0, 22.5 * this.viewScale, 0.01);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
          material.dispose();
        }
      }
    });
    this.renderer.dispose();
    delete window.__gameMetrics;
    window.__GAME_READY__ = false;
    window.__SCENE_READY__ = false;
  }
}

declare global {
  interface Window {
    __GAME_READY__?: boolean;
    __SCENE_READY__?: boolean;
    __gameMetrics?: () => PerformanceMetrics;
  }
}
