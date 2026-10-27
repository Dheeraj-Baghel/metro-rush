// React shell: canvas + state-driven overlays. The engine lives outside the
// React lifecycle; HUD snapshots arrive ~10x/s through a listener.
import { useEffect, useRef, useState, useCallback } from 'react';
import { Game, type GameStateName, type HudData } from './game/game';
import { DEFAULT_SETTINGS, type Settings } from './game/config';
import { IconCoin, IconPause, IconPlay, IconRetry, IconHome, IconGear, IconHelp, IconTrophy, IconSpeaker, IconArrow, POWER_ICON, POWER_NAME, POWER_COLOR } from './icons';

const EMPTY: HudData = {
  score: 0, distance: 0, coins: 0, totalCoinsRun: 0, multiplier: 1, speed: 0, countdown: 3,
  bestScore: 0, newHighScore: false, load: { stage: 'download', fraction: 0, detail: 'Starting' },
  loadError: null, revealed: false, showTutorial: false, tutorialStep: 0, powerups: [],
};

const STAGES: { key: string; label: string }[] = [
  { key: 'download', label: 'Download' }, { key: 'decode', label: 'Decode' },
  { key: 'validate', label: 'Validate' }, { key: 'prepare', label: 'Build scene' },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [state, setState] = useState<GameStateName>('LOADING');
  const [hud, setHud] = useState<HudData>(EMPTY);
  const [panel, setPanel] = useState<'none' | 'settings' | 'help'>('none');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [webglFail, setWebglFail] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || gameRef.current) return;
    const game = new Game();
    gameRef.current = game;
    setSettings(game.save.settings);
    game.onUi((s, h) => { setState(s); setHud(h); });
    game.mount(canvasRef.current);
    if (!game.webglOk) setWebglFail(true);
    return () => { game.unmount(); gameRef.current = null; };
  }, []);

  const g = () => gameRef.current!;
  const apply = useCallback((s: Settings) => { setSettings(s); gameRef.current?.updateSettings(s); }, []);
  const closePanel = () => { g().uiBack(); setPanel('none'); };

  if (webglFail) {
    return (
      <div className="fallback" role="alert">
        <Logo />
        <p>Metro Rush needs WebGL, which isn’t available in this browser or is turned off.</p>
        <p>Try a current version of Chrome, Edge, Firefox or Safari, and check that hardware acceleration is enabled.</p>
      </div>
    );
  }

  const loading = state === 'LOADING' || state === 'LOAD_ERROR';

  return (
    <div className="app">
      <canvas ref={canvasRef} className={`game-canvas ${hud.revealed ? 'revealed' : ''}`} />

      {loading && <LoadingScreen hud={hud} error={state === 'LOAD_ERROR'} onRetry={() => g().retryLoading()} />}

      {state === 'MAIN_MENU' && panel === 'none' && (
        <div className="overlay menu">
          <div className="menu-card">
            <Logo />
            <p className="tagline">Run fast. Dodge everything. Own the city.</p>
            <button className="btn primary big" autoFocus aria-label="Play" onClick={() => g().startGame()}>
              <IconPlay /> PLAY
            </button>
            <div className="menu-row">
              <button className="btn ghost" onClick={() => { g().uiClick(); setPanel('help'); }}><IconHelp /> How to play</button>
              <button className="btn ghost" onClick={() => { g().uiClick(); setPanel('settings'); }}><IconGear /> Settings</button>
            </div>
            <div className="menu-stats">
              <span><IconTrophy /> Best <strong>{hud.bestScore.toLocaleString()}</strong></span>
              <span><IconCoin /> <strong>{hud.coins.toLocaleString()}</strong></span>
            </div>
          </div>
        </div>
      )}

      {panel === 'help' && (
        <div className="overlay dim" onClick={closePanel}>
          <div className="panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How to play">
            <h2>How to play</h2>
            <ControlsGrid />
            <ul className="power-list">
              {Object.keys(POWER_ICON).map((k) => {
                const I = POWER_ICON[k];
                return <li key={k}><span className="pchip" style={{ color: POWER_COLOR[k] }}><I /></span>{POWER_NAME[k]}<em>{k === 'magnet' ? 'pulls in nearby coins' : k === 'jetpack' ? 'fly over everything' : k === 'shield' ? 'survive one hit' : 'score counts twice'}</em></li>;
              })}
            </ul>
            <p className="note">Ride the yellow-striped ramps to run along train roofs.</p>
            <button className="btn primary" onClick={closePanel}>Got it</button>
          </div>
        </div>
      )}

      {panel === 'settings' && <SettingsPanel settings={settings} onChange={apply} onClose={closePanel} />}

      {state === 'COUNTDOWN' && (
        <div className="overlay countdown" aria-live="assertive">
          <div className="count-num" key={hud.countdown}>{hud.countdown}</div>
        </div>
      )}

      {(state === 'PLAYING' || state === 'COUNTDOWN') && (
        <div className="hud" aria-live="off">
          <div className="hud-left">
            <div className="hud-score" aria-label="Score">{hud.score.toLocaleString()}</div>
            <div className="hud-sub">{hud.distance} m{hud.multiplier > 1 && <b className="mult">×{hud.multiplier}</b>}</div>
          </div>
          <div className="hud-right">
            <div className="hud-coins" aria-label="Coins"><IconCoin /> {hud.totalCoinsRun}</div>
            <button className="icon-btn" onClick={() => g().pause()} aria-label="Pause"><IconPause /></button>
          </div>
          {hud.powerups.length > 0 && (
            <div className="power-bar">
              {hud.powerups.map((p) => {
                const I = POWER_ICON[p.kind];
                return (
                  <div className="power-chip" key={p.kind} style={{ ['--pc' as any]: POWER_COLOR[p.kind] }}>
                    <I />
                    <div className="power-meter"><div className="power-fill" style={{ transform: `scaleX(${p.remaining / p.duration})` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
          {hud.showTutorial && <TutorialHint step={hud.tutorialStep} onSkip={() => g().dismissTutorial()} />}
        </div>
      )}

      {state === 'PAUSED' && panel === 'none' && (
        <div className="overlay dim">
          <div className="panel narrow" role="dialog" aria-label="Paused">
            <h2>Paused</h2>
            <button className="btn primary" autoFocus onClick={() => g().resume()}><IconPlay /> Resume</button>
            <button className="btn" onClick={() => g().restart()}><IconRetry /> Restart</button>
            <button className="btn" onClick={() => { g().uiClick(); setPanel('settings'); }}><IconGear /> Settings</button>
            <button className="btn ghost" onClick={() => g().toMenu()}><IconHome /> Main menu</button>
          </div>
        </div>
      )}

      {state === 'GAME_OVER' && (
        <div className="overlay dim gameover-wrap">
          <div className="panel gameover" role="dialog" aria-label="Run over">
            <div className={`go-badge ${hud.newHighScore ? 'record' : ''}`}>{hud.newHighScore ? <><IconTrophy /> New best!</> : 'Run over'}</div>
            <div className="go-score">{hud.score.toLocaleString()}</div>
            <div className="go-stats">
              <div><span>Best</span><strong>{hud.bestScore.toLocaleString()}</strong></div>
              <div><span>Coins</span><strong><IconCoin /> {hud.totalCoinsRun}</strong></div>
              <div><span>Distance</span><strong>{hud.distance} m</strong></div>
            </div>
            <button className="btn primary big" autoFocus onClick={() => g().restart()}><IconRetry /> Retry</button>
            <button className="btn ghost" onClick={() => g().toMenu()}><IconHome /> Main menu</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Logo() {
  return (
    <h1 className="logo" aria-label="Metro Rush">
      <span className="logo-m" aria-hidden>M</span>
      <span className="logo-words"><span>METRO</span><span>RUSH</span></span>
    </h1>
  );
}

function LoadingScreen({ hud, error, onRetry }: { hud: HudData; error: boolean; onRetry: () => void }) {
  const idx = STAGES.findIndex((s) => s.key === hud.load.stage);
  const measured = hud.load.stage === 'download' && hud.load.fraction !== null;
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-card">
        <Logo />
        {!error ? (
          <>
            <div className={`loadbar ${measured ? '' : 'indeterminate'}`}>
              <div className="loadbar-fill" style={measured ? { transform: `scaleX(${hud.load.fraction})` } : undefined} />
            </div>
            <ol className="stages">
              {STAGES.map((s, i) => (
                <li key={s.key} className={i < idx ? 'done' : i === idx ? 'active' : ''}>{s.label}</li>
              ))}
            </ol>
            <p className="load-detail">{hud.load.detail}{measured ? ` · ${Math.round((hud.load.fraction ?? 0) * 100)}%` : ''}</p>
          </>
        ) : (
          <>
            <p className="load-error">We couldn’t load everything the station needs.</p>
            <p className="load-detail mono">{hud.loadError}</p>
            <button className="btn primary" autoFocus onClick={onRetry}><IconRetry /> Retry</button>
            <p className="note">Files that already loaded are kept — only the missing ones are requested again.</p>
          </>
        )}
      </div>
    </div>
  );
}

function ControlsGrid() {
  return (
    <div className="controls-grid">
      {([
        ['left', '← / A', 'Swipe left', 'Change lane'],
        ['right', '→ / D', 'Swipe right', 'Change lane'],
        ['up', '↑ / W / Space', 'Swipe up', 'Jump barriers'],
        ['down', '↓ / S', 'Swipe down', 'Slide under signs'],
      ] as const).map(([d, k, t, what]) => (
        <div className="ctl" key={d}>
          <span className="ctl-ic"><IconArrow dir={d} /></span>
          <span className="ctl-what">{what}</span>
          <span className="ctl-keys"><kbd>{k}</kbd><small>{t}</small></span>
        </div>
      ))}
      <div className="ctl"><span className="ctl-ic"><IconPause /></span><span className="ctl-what">Pause</span><span className="ctl-keys"><kbd>Esc / P</kbd></span></div>
    </div>
  );
}

function TutorialHint({ step, onSkip }: { step: number; onSkip: () => void }) {
  const steps: [('left' | 'up' | 'down' | 'right'), string][] = [['left', 'Swipe or press ← → to change lane'], ['up', 'Swipe up or press Space to jump'], ['down', 'Swipe down or press ↓ to slide'], ['right', 'Dodge the train — switch lanes!']];
  const [dir, text] = steps[Math.min(step, 3)];
  return (
    <div className="tutorial" role="note">
      <span className="tut-ic"><IconArrow dir={dir} /></span>
      <span>{text}</span>
      <button className="tut-skip" onClick={onSkip} aria-label="Skip tutorial">Skip</button>
    </div>
  );
}

function SettingsPanel({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const slider = (key: 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'ambienceVolume', label: string) => (
    <label className="setting-row">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={settings[key]} aria-label={label}
        onChange={(e) => set({ [key]: +e.target.value } as Partial<Settings>)} />
      <output>{Math.round(settings[key] * 100)}</output>
    </label>
  );
  return (
    <div className="overlay dim" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <div className="setting-row">
          <span>Graphics</span>
          <div className="seg" role="radiogroup" aria-label="Graphics quality">
            {(['LOW', 'MEDIUM', 'HIGH'] as const).map((p) => (
              <button key={p} role="radio" aria-checked={settings.graphics === p} className={settings.graphics === p ? 'seg-btn active' : 'seg-btn'} onClick={() => set({ graphics: p })}>{p[0] + p.slice(1).toLowerCase()}</button>
            ))}
          </div>
        </div>
        {slider('masterVolume', 'Master')}
        {slider('musicVolume', 'Music')}
        {slider('sfxVolume', 'Effects')}
        {slider('ambienceVolume', 'Ambience')}
        <div className="setting-row">
          <span>Sound</span>
          <button className={`btn small ${settings.muted ? '' : 'on'}`} aria-pressed={!settings.muted} onClick={() => set({ muted: !settings.muted })}>
            <IconSpeaker muted={settings.muted} /> {settings.muted ? 'Muted' : 'On'}
          </button>
        </div>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
