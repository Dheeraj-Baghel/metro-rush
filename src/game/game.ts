// METRO RUSH engine: renderer, staged loading, chase camera, fixed-step
// physics, swept collisions with train-roof landings, scoring, power-ups and
// the state machine. Runs outside React and emits throttled HUD snapshots.
import * as THREE from 'three';
import { CONFIG, CAMERA, loadSave, writeSave, type SaveData, type Settings, type GraphicsPreset } from './config';
import { InputSystem, type GameAction } from './input';
import { AudioSystem } from './audio';
import { Player } from './player';
import { World, type WorldEvents, type Obstacle } from './world';
import { ParticleSystem } from './particles';
import { loadAssets, AssetLoadError, type LoadProgress, type LoadedAssets } from './assets';
import { ROOF_Y } from './sequences';

export type GameStateName = 'LOADING' | 'LOAD_ERROR' | 'MAIN_MENU' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';
type PowerKey = 'magnet' | 'jetpack' | 'shield' | 'multiplier';

export interface HudData {
  score: number; distance: number; coins: number; totalCoinsRun: number;
  multiplier: number; speed: number; countdown: number;
  bestScore: number; newHighScore: boolean;
  load: LoadProgress; loadError: string | null; revealed: boolean;
  showTutorial: boolean; tutorialStep: number;
  powerups: { kind: string; remaining: number; duration: number }[];
}

type UiListener = (state: GameStateName, hud: HudData) => void;

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private player!: Player;
  private world!: World;
  private particles!: ParticleSystem;
  input = new InputSystem();
  audio: AudioSystem;
  save: SaveData;

  state: GameStateName = 'LOADING';
  private raf = 0;
  private lastT = 0;
  private accumulator = 0;
  private speed: number = CONFIG.startSpeed;
  private score = 0;
  private coinsRun = 0;
  private multiplier = 1;
  private countdownT = 0;
  private elapsed = 0;
  private shake = 0;
  private camY = 0;
  private camX = 0;
  private newHigh = false;
  private uiListeners: UiListener[] = [];
  private hudTimer = 0;
  private powerTimers: Partial<Record<PowerKey, number>> = {};
  private invuln = 0;
  private nextMilestone = 500;
  private tmpBox = new THREE.Box3();
  private prevBox = new THREE.Box3();
  private sweep = new THREE.Box3();
  private v3 = new THREE.Vector3();
  private canvas: HTMLCanvasElement | null = null;
  private events: WorldEvents = { trainWarn: null };
  private load: LoadProgress = { stage: 'download', fraction: 0, detail: 'Starting' };
  private loadError: string | null = null;
  private revealed = false;
  private tutorialStep = 0;
  private assets: LoadedAssets | null = null;
  private abort = new AbortController();
  private disposed = false;
  private portrait = false;
  webglOk = true;

  private resizeHandler = () => this.resize();
  private visHandler = () => {
    if (document.hidden) {
      if (this.state === 'PLAYING') this.pause();
      this.audio.suspend();
    } else if (this.state !== 'PAUSED') this.audio.resume();
    this.lastT = performance.now();
    this.accumulator = 0;
  };
  private ctxLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(this.raf); };
  private ctxRestored = () => { this.lastT = performance.now(); this.loop(this.lastT); };

  constructor() {
    this.save = loadSave();
    this.audio = new AudioSystem(this.save.settings);
  }

  mount(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch { this.webglOk = false; return; }
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    canvas.addEventListener('webglcontextlost', this.ctxLost);
    canvas.addEventListener('webglcontextrestored', this.ctxRestored);

    this.scene = new THREE.Scene();
    this.buildSky();
    this.camera = new THREE.PerspectiveCamera(CAMERA.landscape.fov, 1, 0.1, 320);

    // lighting: soft blue sky + warm low sun from the right/front
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0xc9a77f, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe2bd, 2.4);
    this.sun.position.set(16, 22, 8);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 6; sc.bottom = -34; sc.near = 1; sc.far = 70;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.player = new Player();
    this.scene.add(this.player.group);
    this.particles = new ParticleSystem(360);
    this.scene.add(this.particles.points);
    this.world = new World(this.scene);
    this.player.support = (x, z, hw) => this.world.support(x, z, hw);
    this.player.onLand = (fromH) => {
      this.audio.play('land');
      this.shake = Math.max(this.shake, CAMERA.landShake * Math.min(1.6, 0.6 + fromH * 0.4));
      this.particles.emit(this.v3.copy(this.player.group.position).setY(this.player.y + 0.06), 8, 0xcbb9a0, 2.2, 0.35);
    };
    this.player.onFootstep = () => {
      if (this.state !== 'PLAYING' || !this.player.grounded || this.player.sliding) return;
      this.audio.footstep();
      if (Math.random() < 0.35) this.particles.emit(this.v3.copy(this.player.group.position).setY(this.player.y + 0.04), 2, 0xcdbfa8, 1.0, 0.28);
    };

    this.resize();
    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('orientationchange', this.resizeHandler);
    document.addEventListener('visibilitychange', this.visHandler);
    this.input.attach(canvas);
    this.input.onAction((a) => this.handleAction(a));
    // Native QA may inspect the local production build, but the public release
    // must not expose deterministic collision/god-mode helpers on window.
    const localQaHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    if (localQaHost) (window as any).__metro = { scene: this.scene, game: this };

    this.setState('LOADING');
    this.startLoading();
  }

  // ---------- staged loading ----------
  /** Public so the loading screen's Retry can call it. Cached bytes are reused. */
  async startLoading() {
    this.loadError = null;
    this.setState('LOADING');
    try {
      const a = await loadAssets((p) => { if (this.disposed) return; this.load = p; this.emitUi(); }, 'opening', this.abort.signal);
      if (this.disposed) return;
      this.assets = a;
      this.load = { stage: 'prepare', fraction: null, detail: 'Building the station' };
      this.emitUi();
      await nextFrame();
      this.prepareScene(a);
      this.load = { stage: 'prepare', fraction: null, detail: 'Compiling shaders' };
      this.emitUi();
      await nextFrame();
      await this.warmUp();
      if (this.disposed) return;
      this.load = { stage: 'ready', fraction: 1, detail: 'Ready' };
      this.revealed = true;
      this.setState('MAIN_MENU');
      this.lastT = performance.now();
      this.loop(this.lastT);
      // later districts stream in after reveal, never blocking startup
      loadAssets(() => {}, 'later', this.abort.signal).then((l) => {
        if (this.disposed) return;
        for (const [k, v] of l.models) this.assets!.models.set(k, v);
      }).catch((e) => console.warn('[metro-rush] background district assets unavailable', e));
    } catch (e) {
      if (this.disposed) return;
      const failures = e instanceof AssetLoadError ? e.failures.map((f) => f.url.split('/').pop()).join(', ') : String((e as Error).message ?? e);
      this.loadError = failures;
      this.load = { stage: 'error', fraction: null, detail: 'Some files could not be loaded' };
      this.setState('LOAD_ERROR');
    }
  }

  private prepared = false;
  private prepareScene(a: LoadedAssets) {
    if (this.prepared) return;
    this.prepared = true;
    this.world.build(a);
    if (!a.runner || !this.player.attachRunner(a.runner.root, a.runner.clips)) {
      throw new Error('runner rig failed validation');
    }
    this.audio.provide(a.audio);
    this.applyGraphics(this.save.settings.graphics);
    this.world.reset(1234, false);
    // pre-place a showcase stretch for the menu
    this.player.reset();
    this.player.anim = 'idle';
    this.updateMenuCamera(0);
  }

  /** Compile every material variant and render a few frames off-screen so
   *  the first jump/slide/train/coin never triggers a shader compile. */
  private async warmUp() {
    // make every pooled object visible for one compile pass
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    this.player.shieldMesh.visible = this.player.boardMesh.visible = this.player.jetMesh.visible = true;
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> };
    if (r.compileAsync) await r.compileAsync(this.scene, this.camera);
    else r.compile(this.scene, this.camera);
    // shadow-pass (depth) programs are only built when a caster is inside the
    // light frustum during a real render: line every pooled hazard/pickup up
    // just ahead of the runner and render real frames so each depth-material
    // variant compiles before the reveal (first-train stutter otherwise)
    const moved: [THREE.Object3D, THREE.Vector3][] = [];
    let k = 0;
    for (const o of hidden) {
      if (o.parent !== this.world.group) continue;
      moved.push([o, o.position.clone()]);
      o.position.set(CONFIG.lanes[k % 3], o.position.y, -4 - Math.floor(k / 3) * 1.2);
      k++;
    }
    const camPos = this.camera.position.clone(), camQ = this.camera.quaternion.clone();
    this.camera.position.set(0, 3, 6); this.camera.lookAt(0, 1, -12);
    for (let i = 0; i < 3; i++) { r.render(this.scene, this.camera); await nextFrame(); }
    // the station kit's pooled dressing (buildings, shelters, walls...) also
    // casts shadows; dress one chunk per district so their depth variants
    // compile too, then restore the opening layout
    this.world.warmDistricts(() => r.render(this.scene, this.camera));
    for (const [o, p] of moved) o.position.copy(p);
    this.camera.position.copy(camPos); this.camera.quaternion.copy(camQ);
    for (const o of hidden) o.visible = false;
    this.player.shieldMesh.visible = this.player.boardMesh.visible = this.player.jetMesh.visible = false;
    r.render(this.scene, this.camera);
  }

  unmount() {
    this.disposed = true;
    this.abort.abort();
    this.uiListeners.length = 0;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('orientationchange', this.resizeHandler);
    document.removeEventListener('visibilitychange', this.visHandler);
    this.canvas?.removeEventListener('webglcontextlost', this.ctxLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.ctxRestored);
    if (this.canvas) this.input.detach(this.canvas);
    this.audio.stopRunSounds(); this.audio.stopMusic(0.05); this.audio.stopAmbience(0.05);
    this.renderer?.dispose();
  }

  private buildSky() {
    // vertical gradient sky dome: soft blue zenith -> warm hazy horizon
    const geo = new THREE.SphereGeometry(300, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x5fa8e6) }, mid: { value: new THREE.Color(0xa9d2f2) }, bot: { value: new THREE.Color(0xf6dcc0) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0); }',
      // #include must start its own line in GLSL
      fragmentShader: [
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;',
        'void main(){',
        '  float h = normalize(vP).y;',
        '  vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(bot, mid, smoothstep(-0.05, 0.12, h));',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <colorspace_fragment>',
        '}',
      ].join('\n'),
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.sky = sky;
    // atmospheric depth: fog matches the horizon haze, not a heavy orange wash
    this.scene.fog = new THREE.Fog(0xe9e1d3, CONFIG.fogNear, CONFIG.fogFar);
  }
  private sky!: THREE.Mesh;

  onUi(fn: UiListener) { this.uiListeners.push(fn); fn(this.state, this.hud()); }
  private emitUi() { const h = this.hud(); for (const fn of this.uiListeners) fn(this.state, h); }

  private hud(): HudData {
    return {
      score: Math.floor(this.score), distance: Math.floor(this.world?.distance ?? 0),
      coins: this.save.totalCoins, totalCoinsRun: this.coinsRun,
      multiplier: this.multiplier, speed: this.speed, countdown: Math.ceil(this.countdownT),
      bestScore: this.save.bestScore, newHighScore: this.newHigh,
      load: this.load, loadError: this.loadError, revealed: this.revealed,
      showTutorial: !this.save.seenTutorial && (this.state === 'PLAYING' || this.state === 'COUNTDOWN') && this.tutorialStep < 4 && (this.world?.distance ?? 0) < TUTORIAL_END,
      tutorialStep: this.tutorialStep,
      powerups: (Object.entries(this.powerTimers) as [PowerKey, number][]).filter(([, v]) => v > 0)
        .map(([kind, v]) => ({ kind, remaining: v, duration: CONFIG.powerupDurations[kind] })),
    };
  }

  private setState(s: GameStateName) { this.state = s; this.emitUi(); }

  // ---------- public UI API ----------
  async startGame() {
    // the Play tap is the audio unlock gesture; never block gameplay on it
    const unlocking = this.audio.unlock();
    this.audio.play('click');
    this.resetRun();
    this.countdownT = 3;
    this.setState('COUNTDOWN');
    await Promise.race([unlocking, new Promise((r) => setTimeout(r, 600))]);
    this.audio.startAmbience();
    this.audio.play('countTick');
  }

  pause() {
    if (this.state !== 'PLAYING') return;
    this.audio.play('click');
    this.audio.suspend();
    this.setState('PAUSED');
  }

  resume() {
    if (this.state !== 'PAUSED') return;
    this.audio.resume();
    this.audio.play('click');
    this.lastT = performance.now();
    this.accumulator = 0;
    this.setState('PLAYING');
  }

  restart() {
    this.audio.unlock();
    this.audio.resume();
    this.audio.play('click');
    this.audio.stopRunSounds();
    this.audio.stopMusic(0.2);
    this.resetRun();
    this.countdownT = 3;
    this.setState('COUNTDOWN');
    this.audio.play('countTick');
  }

  toMenu() {
    this.audio.resume();
    this.audio.play('back');
    this.audio.stopRunSounds();
    this.audio.stopMusic(0.4);
    this.resetRun();
    this.world.reset(1234, false);
    this.player.anim = 'idle';
    this.setState('MAIN_MENU');
  }

  retryLoading() { this.startLoading(); }

  updateSettings(s: Settings) {
    const gfxChanged = s.graphics !== this.save.settings.graphics;
    this.save.settings = s;
    writeSave(this.save);
    this.audio.applySettings(s);
    if (gfxChanged) this.applyGraphics(s.graphics);
  }

  uiClick() { this.audio.unlock(); this.audio.play('click'); }
  uiBack() { this.audio.unlock(); this.audio.play('back'); }

  dismissTutorial() { this.save.seenTutorial = true; writeSave(this.save); this.emitUi(); }

  /** Presets differ meaningfully: resolution, shadow quality, dressing density. */
  private applyGraphics(preset: GraphicsPreset) {
    if (!this.renderer) return;
    const dprCap = preset === 'LOW' ? 1 : preset === 'MEDIUM' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    const shadows = preset !== 'LOW';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const size = preset === 'HIGH' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as any).map = null;
    }
    this.renderer.shadowMap.type = preset === 'HIGH' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.world.decorationDensity = preset === 'LOW' ? 0.45 : preset === 'MEDIUM' ? 0.75 : 1;
    this.scene.fog = new THREE.Fog(0xe9e1d3, CONFIG.fogNear * (preset === 'LOW' ? 0.75 : 1), CONFIG.fogFar * (preset === 'LOW' ? 0.75 : 1));
    this.camera.far = preset === 'LOW' ? 220 : 320;
    this.resize();
  }

  private resetRun() {
    this.speed = CONFIG.startSpeed;
    this.score = 0; this.coinsRun = 0; this.multiplier = 1;
    this.elapsed = 0; this.shake = 0; this.invuln = 0;
    this.newHigh = false; this.powerTimers = {};
    this.nextMilestone = 500;
    this.accumulator = 0;
    this.tutorialStep = 0;
    this.player.reset();
    this.world.reset(undefined, !this.save.seenTutorial || true);
    this.camX = 0; this.camY = this.cam().height;
  }

  private cam() { return this.portrait ? CAMERA.portrait : CAMERA.landscape; }

  // ---------- input ----------
  private handleAction(a: GameAction) {
    if (a === 'pause') {
      if (this.state === 'PLAYING') this.pause();
      else if (this.state === 'PAUSED') this.resume();
      return;
    }
    if (this.state !== 'PLAYING') return;
    switch (a) {
      case 'left': if (this.player.moveLane(-1)) this.audio.play('lane'); break;
      case 'right': if (this.player.moveLane(1)) this.audio.play('lane'); break;
      case 'jump': if (this.player.jump()) this.audio.play('jump'); break;
      case 'slide': if (this.player.slide()) this.audio.play('slide'); break;
    }
    if (this.tutorialStep < 4) this.advanceTutorial(a);
  }

  private advanceTutorial(a: GameAction) {
    const order: GameAction[] = ['left', 'jump', 'slide', 'right'];
    // any lane move satisfies the lane step
    const want = order[this.tutorialStep];
    if (a === want || (want === 'left' && a === 'right') || (want === 'right' && a === 'left')) {
      this.tutorialStep++;
      if (this.tutorialStep >= 4) this.dismissTutorial();
      this.emitUi();
    }
  }

  // ---------- loop ----------
  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    dt = Math.min(Math.max(dt, 0), 0.05);

    switch (this.state) {
      case 'MAIN_MENU':
        this.player.animate(dt, 0, true);
        this.updateMenuCamera(t);
        this.particles.update(dt, 0);
        break;
      case 'COUNTDOWN': {
        const prev = Math.ceil(this.countdownT);
        this.countdownT -= dt;
        const now = Math.ceil(this.countdownT);
        if (now !== prev && now > 0) this.audio.play('countTick');
        this.player.anim = 'idle';
        this.player.animate(dt, 0, true);
        this.updateCamera(dt);
        if (this.countdownT <= 0) {
          this.audio.play('countGo');
          this.audio.startMusic();
          this.player.anim = 'run';
          this.setState('PLAYING');
        } else this.emitUi();
        break;
      }
      case 'PLAYING': this.tick(dt); break;
      case 'PAUSED': break;
      case 'GAME_OVER':
        this.player.animate(dt, 0);
        this.updateCamera(dt);
        this.particles.update(dt, 0);
        break;
      default: return; // LOADING / LOAD_ERROR: nothing rendered yet
    }
    this.renderer.render(this.scene, this.camera);
  };

  private tick(dt: number) {
    this.elapsed += dt;
    this.speed = Math.min(CONFIG.maxSpeed, this.speed + CONFIG.speedRampPerSec * dt);
    for (const k of Object.keys(this.powerTimers) as PowerKey[]) {
      this.powerTimers[k]! -= dt;
      if (this.powerTimers[k]! <= 0) { delete this.powerTimers[k]; this.deactivatePower(k); }
    }
    if (this.invuln > 0) this.invuln -= dt;

    // fixed sub-steps: world + player + swept collision move together, so a
    // fast frame can never tunnel through a 0.36 m barrier
    this.accumulator += dt;
    const h = CONFIG.physicsStep;
    let steps = 0;
    while (this.accumulator >= h && steps < 12 && this.state === 'PLAYING') {
      this.accumulator -= h; steps++;
      this.world.update(h, this.speed, this.events);
      if (this.events.trainWarn) this.onTrainWarn(this.events.trainWarn);
      this.player.getCollider(this.prevBox);
      this.player.step(h);
      this.collide();
    }
    this.score += CONFIG.scorePerMeter * this.speed * dt * this.multiplier;
    if (this.score > this.nextMilestone) { this.nextMilestone += 1000; this.player.animator?.celebrate(); }

    this.collectCoins(dt);
    this.collectPowerUps();
    this.updateTrainAudio();
    this.player.animate(dt, this.speed);
    this.particles.update(dt, this.speed * dt);
    this.updateCamera(dt);

    // tutorial: each hint matches the tutorial sequence the runner is in
    // (t-coins-lane 18..62 m, t-jump ..102, t-slide ..142, t-train ..190)
    if (!this.save.seenTutorial) {
      const d = this.world.distance;
      const byDist = d < 62 ? 0 : d < 102 ? 1 : d < 142 ? 2 : d < TUTORIAL_END ? 3 : 4;
      if (byDist > this.tutorialStep) { this.tutorialStep = byDist; this.emitUi(); }
      if (this.tutorialStep >= 4) this.dismissTutorial();
    }
    this.hudTimer += dt;
    if (this.hudTimer > 0.1) { this.hudTimer = 0; this.emitUi(); }
  }

  private onTrainWarn(o: Obstacle) {
    this.audio.play('trainHorn');
    this.audio.trainStart(o, o.lane);
  }

  private updateTrainAudio() {
    for (const o of this.world.obstacles) {
      if (o.kind !== 'movingTrain' || !o.warned) continue;
      const front = o.z + o.len / 2; // distance of near end to player (negative = ahead)
      if (front > o.len + 20) { this.audio.trainStop(o); continue; }
      this.audio.trainUpdate(o, -front, o.lane - this.player.targetLane);
    }
  }

  // ---------- camera ----------
  private updateCamera(dt: number) {
    const C = this.cam();
    const p = this.player.group.position;
    const onRoof = this.player.groundY > 0.5;
    const follow = this.player.jetpack ? 0.8 : onRoof ? CAMERA.roofFollow : CAMERA.jumpFollow;
    // airborne after leaving a roof: track the falling body smoothly instead
    // of snapping the base height to the ground surface
    const baseY = this.player.grounded ? this.player.groundY : Math.max(0, Math.min(this.player.y, this.player.groundY));
    // sliding: lower the camera slightly so the low pose stays framed
    const slideDip = this.player.sliding ? -0.55 : 0;
    const targetY = C.height + baseY * follow + slideDip + (this.player.grounded ? 0 : (this.player.y - baseY) * 0.25);
    this.camY += (targetY - this.camY) * Math.min(1, dt * CAMERA.heightDamp);
    this.camX += (p.x * C.follow - this.camX) * Math.min(1, dt * CAMERA.lateralDamp);
    const bob = this.state === 'PLAYING' && this.player.grounded && !this.player.sliding ? Math.sin(this.elapsed * 13) * CAMERA.bobAmplitude : 0;
    this.shake = Math.max(0, this.shake - dt * CAMERA.shakeDecay);
    const s = this.shake * this.shake;
    this.camera.position.set(this.camX + (Math.random() - 0.5) * s, this.camY + bob + (Math.random() - 0.5) * s, C.distance);
    this.camera.lookAt(this.camX * 0.9, C.lookHeight + baseY * follow * 0.75 + slideDip * 0.6, -C.lookAhead);
    const speedFrac = (this.speed - CONFIG.startSpeed) / (CONFIG.maxSpeed - CONFIG.startSpeed);
    const fov = C.fov + speedFrac * CAMERA.speedFovGain + (this.player.jetpack ? 3 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 2);
      this.camera.updateProjectionMatrix();
    }
    // shadow frustum follows the runner laterally
    this.sun.position.set(16 + p.x, 22, 8);
    this.sun.target.position.set(p.x, 0, -12);
  }

  private updateMenuCamera(t: number) {
    // composed hero shot: runner left-of-centre on the platform edge, train
    // and station shelter behind, UI stack on the right half
    const a = Math.sin(t * 0.00018) * 0.12;
    const p = this.portrait;
    // landscape: runner left third, card right. portrait: runner centred in
    // the upper half above the bottom card, framed full-body.
    this.camera.position.set(p ? 0.9 + a * 0.5 : 2.6 + a, p ? 1.35 : 1.55, p ? 4.9 : 3.6);
    this.camera.lookAt(p ? 0.15 : 1.15 + a * 0.4, p ? 0.55 : 1.05, -2.2);
    const fov = p ? 50 : 46;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.sun.position.set(16, 22, 8);
    this.sun.target.position.set(0, 0, -12);
  }

  // ---------- collisions ----------
  private collide() {
    if (this.player.crashed) return;
    const pb = this.player.getCollider(this.tmpBox);
    // swept volume between last and current sub-step
    this.sweep.copy(this.prevBox).union(pb);
    for (const o of this.world.obstacles) {
      if (!o.active || o.box.isEmpty()) continue;
      if (o.box.min.z > pb.max.z + 0.5 || o.box.max.z < pb.min.z - 0.5) continue;
      if (!this.sweep.intersectsBox(o.box)) continue;
      // trains: landing on top is valid — only a hit if feet are below the roof
      if ((o.kind === 'train' || o.kind === 'movingTrain') && this.player.y >= ROOF_Y - CONFIG.roofLandTolerance) continue;
      if (!pb.intersectsBox(o.box) && !this.crossed(o)) continue;
      if (this.invuln > 0) continue;
      if (this.powerTimers.shield) { this.absorbHit(o); return; }
      this.gameOver(o);
      return;
    }
  }

  /** true if the swept motion passed through o this step (thin hazards at speed) */
  private crossed(o: Obstacle) {
    const a = this.prevBox, b = this.tmpBox;
    const yOverlap = Math.min(a.max.y, b.max.y) > o.box.min.y && Math.max(a.min.y, b.min.y) < o.box.max.y;
    const xOverlap = Math.min(a.max.x, b.max.x) > o.box.min.x && Math.max(a.min.x, b.min.x) < o.box.max.x;
    return yOverlap && xOverlap;
  }

  private absorbHit(o: Obstacle) {
    this.particles.emit(this.v3.copy(this.player.group.position).setY(this.player.y + 1), 22, 0x8ff3ff, 5, 0.6);
    this.audio.play('crashMetal');
    delete this.powerTimers.shield;
    this.deactivatePower('shield');
    this.invuln = 1.0;
    this.shake = CAMERA.crashShake * 0.6;
    this.player.animator?.stumble();
    if (o.kind !== 'train' && o.kind !== 'movingTrain') { o.active = false; o.mesh.visible = false; }
    else {
      // can't delete a train: push the player onto the nearest free lane
      const dir = this.player.targetLane === 0 ? 1 : this.player.targetLane === 2 ? -1 : (Math.random() < 0.5 ? -1 : 1);
      this.player.moveLane(dir as -1 | 1);
    }
  }

  private collectCoins(dt: number) {
    const p = this.player.group.position;
    const magnet = !!this.powerTimers.magnet;
    const cy = this.player.y + 0.9;
    for (const c of this.world.coins) {
      if (!c.active) continue;
      const mp = c.mesh.position;
      const dx = mp.x - p.x, dy = mp.y - cy, dz = mp.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (magnet && d2 < CONFIG.magnetRadius * CONFIG.magnetRadius) c.magnetized = true;
      if (c.magnetized) {
        const k = Math.min(1, dt * 12);
        mp.x += (p.x - mp.x) * k; mp.y += (cy - mp.y) * k; mp.z += (p.z - mp.z) * k;
        if (Math.random() < 0.3) this.particles.emit(mp, 1, 0xffd85a, 0.4, 0.25, 0.3);
      }
      const reach = this.player.sliding ? 1.1 : 0.9;
      if (Math.abs(dx) < 0.75 && Math.abs(dz) < reach && Math.abs(dy) < 1.05) {
        c.active = false; c.mesh.visible = false;
        this.coinsRun++;
        this.score += CONFIG.coinValue * this.multiplier;
        this.audio.play('coin');
        this.particles.emit(mp, 7, 0xffd23f, 2.6, 0.35);
      }
    }
  }

  private collectPowerUps() {
    const p = this.player.group.position;
    for (const pu of this.world.powerups) {
      if (!pu.active) continue;
      const mp = pu.mesh.position;
      if (Math.abs(mp.x - p.x) < 0.8 && Math.abs(mp.z - p.z) < 1.0 && Math.abs(mp.y - (this.player.y + 1)) < 1.4) {
        pu.active = false; pu.mesh.visible = false;
        this.audio.play('powerup');
        this.particles.emit(mp, 18, 0xffffff, 4, 0.55);
        this.activatePower(pu.kind);
      }
    }
  }

  private activatePower(kind: PowerKey) {
    this.powerTimers[kind] = CONFIG.powerupDurations[kind];
    this.audio.play('activate');
    switch (kind) {
      case 'jetpack':
        this.player.jetpack = true; this.player.jetMesh.visible = true;
        this.player.sliding = false;
        for (let i = 0; i < 4; i++) this.world.spawnCoinRow(Math.floor(Math.random() * 3), -26 - i * 16, 7, CONFIG.jetpackHeight + 0.9, 1.8);
        break;
      case 'shield': this.player.shield = true; this.player.shieldMesh.visible = true; this.player.boardMesh.visible = true; break;
      case 'multiplier': this.multiplier = 2; break;
      case 'magnet': break;
    }
    this.emitUi();
  }

  private deactivatePower(kind: PowerKey) {
    switch (kind) {
      case 'jetpack':
        this.player.jetpack = false; this.player.jetMesh.visible = false;
        this.player.grounded = false; this.player.vy = 0;
        this.invuln = Math.max(this.invuln, 1.2); // safe descent window
        break;
      case 'shield':
        this.player.shield = false; this.player.shieldMesh.visible = false; this.player.boardMesh.visible = false;
        this.particles.emit(this.v3.copy(this.player.group.position).setY(this.player.y + 1), 12, 0x8ff3ff, 3, 0.45);
        break;
      case 'multiplier': this.multiplier = 1; break;
      case 'magnet': break;
    }
    this.emitUi();
  }

  private resize() {
    if (!this.renderer || !this.canvas) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.portrait = h > w * 1.1;
    this.camera.aspect = w / h;
    if (this.state === 'MAIN_MENU') this.updateMenuCamera(performance.now());
    else this.camera.fov = this.cam().fov;
    this.camera.updateProjectionMatrix();
  }

  private gameOver(o: Obstacle) {
    this.player.crash();
    this.audio.stopRunSounds();
    this.audio.play('crash');
    this.audio.stopMusic(0.25);
    this.shake = CAMERA.crashShake;
    this.particles.emit(this.v3.copy(this.player.group.position).setY(this.player.y + 1.1), 26, 0xf4c430, 5, 0.7);
    const final = Math.floor(this.score);
    if (final > this.save.bestScore) { this.save.bestScore = final; this.newHigh = true; this.audio.play('highScore'); }
    else this.audio.play('gameOver');
    this.save.totalCoins += this.coinsRun;
    writeSave(this.save);
    this.lastHit = o.kind;
    this.setState('GAME_OVER');
  }
  lastHit = '';

  // ---------- debug / QA hooks (read-only + deterministic helpers) ----------
  debugState() {
    return {
      state: this.state, speed: this.speed, distance: this.world.distance,
      player: { lane: this.player.targetLane, y: +this.player.y.toFixed(3), groundY: +this.player.groundY.toFixed(3), grounded: this.player.grounded, sliding: this.player.sliding, anim: this.player.anim, crashed: this.player.crashed },
      world: this.world.stats(), audio: this.audio.debug(), lastHit: this.lastHit,
      validation: this.world.validationLog.slice(-12),
      renderer: { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures },
    };
  }
  /** QA: grant invulnerability so long-play checks are not cut short. */
  debugGodMode(sec: number) { this.invuln = sec; }
  debugSetSpeed(v: number) { this.speed = v; }
  debugGivePower(k: PowerKey) { this.activatePower(k); }
}

const TUTORIAL_END = 190;
function nextFrame() { return new Promise<void>((r) => requestAnimationFrame(() => r())); }
