import { MPS_TO_KMH } from '../config/constants.js';

function formatTime(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--:--.--';
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const cs = Math.floor((totalMs % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Racing HUD & 2D Minimap Controller:
 * - Bottom-right digital Speedometer, 18-segment RPM Tachometer, Gear & Nitro gauge
 * - Top-left Position, Lap, Lap Timers & Top-3 Leaderboard
 * - Bottom-left auto-scaled 2D Canvas Minimap with 7 AI dots + rotating player chevron
 * - Center Countdown / Final Lap / New Best Lap / Wrong Way banners + 8-car Results Modal
 * - Root uses pointer-events: none so 3D garage orbit dragging is never blocked
 */
export class HudController {
  /**
   * @param {HTMLElement} hudRoot
   * @param {HTMLElement} toastRoot
   */
  constructor(hudRoot, toastRoot) {
    this.hudRoot = hudRoot;
    this.toastRoot = toastRoot;
    this.visible = false;

    this.onRaceAgain = null;
    this.onBackToGarage = null;

    this._buildDom();
    this.minimapScale = 1;
    this.minimapOffsetX = 90;
    this.minimapOffsetZ = 90;
    this.trackOutlinePoints = [];
  }

  _buildDom() {
    this.hudEl = document.createElement('div');
    this.hudEl.className = 'race-hud hidden';
    this.hudEl.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-pos-card">
          <div class="hud-pos-main">
            <span class="hud-label">POS</span>
            <span class="hud-pos-val" data-f="pos">1</span>
            <span class="hud-pos-total">/ 8</span>
          </div>
          <div class="hud-lap-box">
            <span class="hud-label">LAP</span>
            <span class="hud-lap-val" data-f="lap">1 / 3</span>
          </div>
        </div>
        <div class="hud-timers-card">
          <div class="hud-timer-row"><span>CURRENT</span><strong data-f="currTime">00:00.00</strong></div>
          <div class="hud-timer-row"><span>BEST</span><strong data-f="bestTime">--:--.--</strong></div>
        </div>
        <div class="hud-leaderboard" data-f="top3"></div>
      </div>

      <div class="hud-bottom-left">
        <canvas class="minimap-canvas" width="176" height="176"></canvas>
      </div>

      <div class="hud-bottom-right">
        <div class="hud-tach-card">
          <div class="hud-speed-row">
            <div class="hud-gear" data-f="gear">N</div>
            <div class="hud-speed-wrap">
              <div class="hud-speed-num" data-f="speed">0</div>
              <div class="hud-speed-unit">KM/H</div>
            </div>
          </div>
          <div class="hud-rpm-bars" data-f="rpmBars"></div>
          <div class="hud-nitro-status hidden" data-f="nitroTag"></div>
          <div class="hud-nitro-row">
            <span class="hud-nitro-label">NITRO</span>
            <div class="hud-nitro-track"><div class="hud-nitro-fill" data-f="nitroFill"></div></div>
          </div>
        </div>
      </div>

      <div class="hud-center-banner hidden" data-f="centerBanner"></div>
      <div class="hud-wrong-way hidden" data-f="wrongWay">WRONG WAY!</div>

      <div class="results-modal hidden" data-f="resultsModal">
        <div class="results-panel">
          <h2>RACE COMPLETE</h2>
          <div class="results-subtitle" data-f="resultsSubtitle">Finish Position: 1st</div>
          <table class="results-table">
            <thead>
              <tr><th>POS</th><th>DRIVER</th><th>VEHICLE</th><th>BEST LAP</th><th>TIME</th></tr>
            </thead>
            <tbody data-f="resultsBody"></tbody>
          </table>
          <div class="results-actions">
            <button type="button" class="btn-primary" data-act="again">Race Again</button>
            <button type="button" class="btn-secondary" data-act="garage">Back to Garage</button>
          </div>
        </div>
      </div>
    `;
    this.hudRoot.appendChild(this.hudEl);

    // Pre-build 3 leaderboard rows (Rule #10: zero per-frame DOM node creation)
    const lbContainer = this.hudEl.querySelector('[data-f="top3"]');
    this.lbRows = [];
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'lb-row';
      const posSpan = document.createElement('span');
      const nameSpan = document.createElement('span');
      row.appendChild(posSpan);
      row.appendChild(nameSpan);
      lbContainer.appendChild(row);
      this.lbRows.push({ row, posSpan, nameSpan });
    }
    this._lastTopKey = '';
    // Pre-build 18 segmented tachometer bars
    const rpmBarsEl = this.hudEl.querySelector('[data-f="rpmBars"]');
    this.rpmSegments = [];
    for (let i = 0; i < 18; i++) {
      const seg = document.createElement('div');
      seg.className = 'rpm-seg';
      rpmBarsEl.appendChild(seg);
      this.rpmSegments.push(seg);
    }

    this.minimapCanvas = this.hudEl.querySelector('.minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    this.f = {
      pos: this.hudEl.querySelector('[data-f="pos"]'),
      lap: this.hudEl.querySelector('[data-f="lap"]'),
      currTime: this.hudEl.querySelector('[data-f="currTime"]'),
      bestTime: this.hudEl.querySelector('[data-f="bestTime"]'),
      top3: this.hudEl.querySelector('[data-f="top3"]'),
      gear: this.hudEl.querySelector('[data-f="gear"]'),
      speed: this.hudEl.querySelector('[data-f="speed"]'),
      nitroFill: this.hudEl.querySelector('[data-f="nitroFill"]'),
      nitroTag: this.hudEl.querySelector('[data-f="nitroTag"]'),
      centerBanner: this.hudEl.querySelector('[data-f="centerBanner"]'),
      wrongWay: this.hudEl.querySelector('[data-f="wrongWay"]'),
      resultsModal: this.hudEl.querySelector('[data-f="resultsModal"]'),
      resultsSubtitle: this.hudEl.querySelector('[data-f="resultsSubtitle"]'),
      resultsBody: this.hudEl.querySelector('[data-f="resultsBody"]'),
    };

    this.hudEl.querySelector('[data-act="again"]').addEventListener('click', () => {
      if (this.onRaceAgain) this.onRaceAgain();
    });
    this.hudEl.querySelector('[data-act="garage"]').addEventListener('click', () => {
      if (this.onBackToGarage) this.onBackToGarage();
    });

    this.bannerTimeout = null;
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast-banner hidden';
    this.toastRoot.appendChild(this.toastEl);
    this.toastTimeout = null;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.hudEl.classList.toggle('hidden', !this.visible);
    if (!this.visible) {
      this.hideResults();
      this.f.wrongWay.classList.add('hidden');
      this.f.centerBanner.classList.add('hidden');
    }
  }

  /**
   * Pre-compute auto-scaled 2D minimap outline from TrackData samples.
   */
  bindTrack(trackData) {
    if (!trackData) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of trackData.samples) {
      if (s.position.x < minX) minX = s.position.x;
      if (s.position.x > maxX) maxX = s.position.x;
      if (s.position.z < minZ) minZ = s.position.z;
      if (s.position.z > maxZ) maxZ = s.position.z;
    }

    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const pad = 18;
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    this.minimapScale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    this.minimapCenterX = (minX + maxX) * 0.5;
    this.minimapCenterZ = (minZ + maxZ) * 0.5;
    this.minimapHalfW = w * 0.5;
    this.minimapHalfH = h * 0.5;

    // Sample every 4th point for ultra-fast minimap stroke
    this.trackOutlinePoints = [];
    for (let i = 0; i < trackData.samples.length; i += 4) {
      const p = trackData.samples[i].position;
      this.trackOutlinePoints.push(this._toMapCoord(p.x, p.z));
    }
  }

  _toMapCoord(wx, wz) {
    // Flip X horizontally so +X (left) maps left and +Z (forward) maps up cleanly!
    return {
      x: this.minimapHalfW - (wx - this.minimapCenterX) * this.minimapScale,
      y: this.minimapHalfH - (wz - this.minimapCenterZ) * this.minimapScale,
    };
  }

  showBanner(text, durationMs = 1500, accent = 'gold') {
    const el = this.f.centerBanner;
    el.textContent = text;
    el.dataset.accent = accent;
    el.classList.remove('hidden');
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => {
      el.classList.add('hidden');
    }, durationMs);
  }

  showToast(message, durationMs = 4500, actionLabel = null, onAction = null) {
    this.toastEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = message;
    this.toastEl.appendChild(span);

    if (actionLabel && onAction) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action-btn';
      btn.textContent = actionLabel;
      btn.addEventListener('click', () => {
        onAction();
        this.toastEl.classList.add('hidden');
      });
      this.toastEl.appendChild(btn);
    }

    this.toastEl.classList.remove('hidden');
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, durationMs);
  }

  showResults(standings) {
    const player = standings.find((r) => r.isPlayer);
    const rank = player ? player.rank : 1;
    const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    this.f.resultsSubtitle.textContent = `You finished ${rank}${suffix} out of ${standings.length} racers`;

    this.f.resultsBody.innerHTML = '';
    for (const r of standings) {
      const tr = document.createElement('tr');
      if (r.isPlayer) tr.className = 'player-row';
      const finishDisplay = r.finished ? formatTime(r.totalTime) : 'RACING';
      tr.innerHTML = `
        <td>#${r.rank}</td>
        <td>${r.name}</td>
        <td>${r.carName}</td>
        <td>${formatTime(r.sessionBestLap ?? r.bestLapTime)}</td>
        <td>${finishDisplay}</td>
      `;
      this.f.resultsBody.appendChild(tr);
    }
    this.f.resultsModal.classList.remove('hidden');
  }

  hideResults() {
    this.f.resultsModal.classList.add('hidden');
  }

  update(raceManager) {
    if (!this.visible || !raceManager.playerRacer) return;

    const player = raceManager.playerRacer;
    const vp = player.vp;

    // 1. Top-left Race Stats
    this.f.pos.textContent = `${player.rank}`;
    this.f.lap.textContent = `${player.lap} / ${raceManager.totalLaps}`;
    this.f.currTime.textContent = formatTime(player.currentLapTime);
    this.f.bestTime.textContent = formatTime(player.bestLapTime);

    let topKey = '';
    for (let i = 0; i < 3; i++) {
      const s = raceManager.standings[i];
      if (s) topKey += `${s.index}:${s.isPlayer ? 1 : 0}|`;
    }
    if (topKey !== this._lastTopKey) {
      this._lastTopKey = topKey;
      for (let i = 0; i < 3; i++) {
        const s = raceManager.standings[i];
        const cell = this.lbRows[i];
        if (!s) {
          cell.row.style.display = 'none';
          continue;
        }
        cell.row.style.display = '';
        cell.row.className = s.isPlayer ? 'lb-row is-player' : 'lb-row';
        cell.posSpan.textContent = `P${i + 1}`;
        cell.nameSpan.textContent = s.name;
      }
    }

    // 2. Bottom-right Digital Speedometer, Tachometer, Gear & Signature Nitro
    const kmh = Math.round(vp.speedMps * MPS_TO_KMH);
    this.f.speed.textContent = `${kmh}`;
    this.f.gear.textContent = vp.gear === -1 ? 'R' : vp.gear === 0 ? 'N' : `${vp.gear}`;
    const uiHex = player.carModel?.spec?.nitroColor?.uiHex || '#00e5ff';
    this.f.nitroFill.style.width = `${Math.round(vp.nitro)}%`;
    this.f.nitroFill.style.background = `linear-gradient(90deg, ${uiHex}88, ${uiHex})`;
    this.f.nitroFill.style.boxShadow = vp.nitroActive || vp.isChargingNitro ? `0 0 12px ${uiHex}` : 'none';

    if (vp.airBonusPulse > 0.1) {
      this.f.nitroTag.textContent = 'CLEAN LANDING +14% NITRO!';
      this.f.nitroTag.className = 'hud-nitro-status mode-air';
    } else if (vp.isAirborne && vp.airTime > 0.16) {
      this.f.nitroTag.textContent = `AIRBORNE ${vp.airTime.toFixed(1)}s • +NITRO`;
      this.f.nitroTag.className = 'hud-nitro-status mode-air';
    } else if (vp.isChargingNitro && vp.isDrifting) {
      this.f.nitroTag.textContent = `DRIFT CHARGE +${Math.round(vp.driftChargeEarned)}%`;
      this.f.nitroTag.className = 'hud-nitro-status mode-drift';
    } else if (vp.exitBoostTimer > 0.1) {
      this.f.nitroTag.textContent = 'DRIFT EXIT SURGE!';
      this.f.nitroTag.className = 'hud-nitro-status mode-boost';
    } else if (vp.nitroActive) {
      this.f.nitroTag.textContent = 'MACH NITRO ACTIVE';
      this.f.nitroTag.className = 'hud-nitro-status mode-boost';
    } else {
      this.f.nitroTag.className = 'hud-nitro-status hidden';
    }

    const activeSegs = Math.round(vp.rpmNormalized * this.rpmSegments.length);
    for (let i = 0; i < this.rpmSegments.length; i++) {
      const seg = this.rpmSegments[i];
      const on = i < activeSegs;
      seg.classList.toggle('on', on);
      seg.classList.toggle('warn', on && i >= 11 && i < 15);
      seg.classList.toggle('red', on && i >= 15);
    }

    // 3. Banners
    this.f.wrongWay.classList.toggle('hidden', !player.wrongWay);
    if (raceManager.finalLapBannerTimer > 0 && raceManager.finalLapBannerTimer > 2.45) {
      this.showBanner('FINAL LAP!', 1800, 'cyan');
    } else if (raceManager.newBestBannerTimer > 0 && raceManager.newBestBannerTimer > 2.45) {
      this.showBanner('NEW BEST LAP!', 1800, 'gold');
    }

    // 4. 2D Canvas Minimap
    this._drawMinimap(raceManager);
  }

  _drawMinimap(raceManager) {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (this.trackOutlinePoints.length < 2) return;

    // Track road ribbon
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < this.trackOutlinePoints.length; i++) {
      const pt = this.trackOutlinePoints[i];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.stroke();

    // Start/finish tick
    const p0 = this.trackOutlinePoints[0];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p0.x - 4, p0.y - 2, 8, 4);

    // 7 AI Dots
    for (let i = 0; i < raceManager.racers.length; i++) {
      const r = raceManager.racers[i];
      if (r.isPlayer) continue;
      const pos = r.carModel.root.position;
      const mp = this._toMapCoord(pos.x, pos.z);
      ctx.fillStyle = `#${r.paintHex.toString(16).padStart(6, '0')}`;
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Player Rotating Directional Chevron
    const player = raceManager.playerRacer;
    if (player) {
      const pos = player.carModel.root.position;
      const mp = this._toMapCoord(pos.x, pos.z);
      const q = player.carModel.root.quaternion;
      // Forward +Z vector in world XZ
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      // Map world (fx, fz) to canvas (-fx, -fz) angle
      const angle = Math.atan2(-fx, -fz);

      ctx.save();
      ctx.translate(mp.x, mp.y);
      ctx.rotate(-angle);
      ctx.fillStyle = '#ff5722';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  dispose() {
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.hudEl.remove();
    this.toastEl.remove();
  }
}
