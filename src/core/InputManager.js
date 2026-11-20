const PREVENT_DEFAULT_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'F2',
  'F3',
  'F4',
]);

const ACTION_BINDINGS = {
  KeyC: 'cycleCamera',
  KeyR: 'resetCar',
  KeyT: 'switchTrack',
  KeyG: 'cycleTheme',
  KeyP: 'cyclePaint',
  KeyM: 'toggleMute',
  KeyV: 'toggleRain',
  Escape: 'togglePause',
  F2: 'toggleTuning',
  F3: 'toggleDebug',
  F4: 'togglePhysicsDebug',
  Digit1: 'selectCar1',
  Digit2: 'selectCar2',
  Digit3: 'selectCar3',
  Digit4: 'selectCar4',
};

/**
 * Unified keyboard, gamepad, and optional touch input manager.
 * Coordinate Convention:
 *   state.throttle: [0..1] (+Z acceleration)
 *   state.brake:    [0..1] (braking / reverse)
 *   state.steer:    [-1..+1] (+1 = left turn toward +X, -1 = right turn toward -X)
 */
export class InputManager {
  constructor() {
    this.keys = new Set();
    this.actionListeners = new Map();
    this.prevGamepadButtons = new Map();

    this.touchState = {
      active: false,
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      nitro: false,
    };

    this.state = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      nitro: false,
      lookBack: false,
    };

    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onBlur = this.clearKeys.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  /**
   * Register a single-press action listener.
   * @param {string} action
   * @param {() => void} callback
   * @returns {() => void}
   */
  onAction(action, callback) {
    if (!this.actionListeners.has(action)) {
      this.actionListeners.set(action, new Set());
    }
    const set = this.actionListeners.get(action);
    set.add(callback);
    return () => set.delete(callback);
  }

  /**
   * @param {string} action
   */
  emitAction(action) {
    const listeners = this.actionListeners.get(action);
    if (!listeners) return;
    for (const cb of listeners) {
      cb();
    }
  }

  /**
   * Inject touch control state from mobile HUD.
   * @param {Partial<typeof this.touchState>} partial
   */
  setTouchInput(partial) {
    Object.assign(this.touchState, partial);
  }

  clearKeys() {
    this.keys.clear();
    this.touchState.active = false;
    this.touchState.throttle = 0;
    this.touchState.brake = 0;
    this.touchState.steer = 0;
    this.touchState.handbrake = false;
    this.touchState.nitro = false;
    this.state.throttle = 0;
    this.state.brake = 0;
    this.state.steer = 0;
    this.state.handbrake = false;
    this.state.nitro = false;
    this.state.lookBack = false;
  }

  /**
   * Poll keyboard, gamepad, and touch into normalized `this.state` (zero allocations).
   */
  update() {
    const keyThrottle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const keyBrake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    const steerLeft = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0;
    const steerRight = this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0;
    const keySteer = steerLeft - steerRight; // +1 = Left (+X), -1 = Right (-X)
    const keyHandbrake = this.keys.has('Space');
    const keyNitro = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const keyLookBack = this.keys.has('KeyB');

    let padThrottle = 0;
    let padBrake = 0;
    let padSteer = 0;
    let padHandbrake = false;
    let padNitro = false;
    let padLookBack = false;

    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : null;
    if (pads) {
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad || !pad.connected) continue;

        const rawAxisX = pad.axes[0] || 0;
        const deadzone = 0.14;
        if (Math.abs(rawAxisX) > deadzone) {
          const scaled = (Math.abs(rawAxisX) - deadzone) / (1 - deadzone);
          // Gamepad stick left is negative X on hardware, map to +1 (+X world left)
          padSteer = -Math.sign(rawAxisX) * Math.min(1, scaled);
        }

        padThrottle = pad.buttons[7]?.value || 0;
        padBrake = pad.buttons[6]?.value || 0;
        padHandbrake = Boolean(pad.buttons[0]?.pressed || pad.buttons[2]?.pressed);
        padNitro = Boolean(pad.buttons[1]?.pressed || pad.buttons[5]?.pressed);
        padLookBack = Boolean(pad.buttons[3]?.pressed);

        this._checkGamepadEdge(pad, 4, 'cycleCamera');
        this._checkGamepadEdge(pad, 8, 'resetCar');
        this._checkGamepadEdge(pad, 9, 'togglePause');
        break;
      }
    }

    const touchThrottle = this.touchState.active ? this.touchState.throttle : 0;
    const touchBrake = this.touchState.active ? this.touchState.brake : 0;
    const touchSteer = this.touchState.active ? this.touchState.steer : 0;

    this.state.throttle = Math.max(keyThrottle, padThrottle, touchThrottle);
    this.state.brake = Math.max(keyBrake, padBrake, touchBrake);
    this.state.steer =
      Math.abs(keySteer) >= Math.abs(padSteer) && Math.abs(keySteer) >= Math.abs(touchSteer)
        ? keySteer
        : Math.abs(padSteer) >= Math.abs(touchSteer)
          ? padSteer
          : touchSteer;
    this.state.handbrake = keyHandbrake || padHandbrake || (this.touchState.active && this.touchState.handbrake);
    this.state.nitro = keyNitro || padNitro || (this.touchState.active && this.touchState.nitro);
    this.state.lookBack = keyLookBack || padLookBack;

    return this.state;
  }

  _checkGamepadEdge(pad, buttonIndex, action) {
    const pressed = Boolean(pad.buttons[buttonIndex]?.pressed);
    const key = `${pad.index}:${buttonIndex}`;
    const wasPressed = this.prevGamepadButtons.get(key) || false;
    if (pressed && !wasPressed) {
      this.emitAction(action);
    }
    this.prevGamepadButtons.set(key, pressed);
  }

  _handleKeyDown(e) {
    if (PREVENT_DEFAULT_CODES.has(e.code)) {
      e.preventDefault();
    }
    if (!e.repeat) {
      const action = ACTION_BINDINGS[e.code];
      if (action) {
        this.emitAction(action);
      }
    }
    this.keys.add(e.code);
  }

  _handleKeyUp(e) {
    this.keys.delete(e.code);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.actionListeners.clear();
    this.keys.clear();
  }
}
