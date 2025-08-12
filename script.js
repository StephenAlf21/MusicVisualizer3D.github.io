import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

document.addEventListener('DOMContentLoaded', () => {
  // --- Globals ---
  let scene, camera, renderer, analyser;
  let audioContext, source, audioElement;
  let playlist = [], currentTrackIndex = -1;
  let isPlaying = false, isSeeking = false;
  let dataArray;

  // Visualizer state
  let web;
  let originalPositions;
  let particles;
  let preset = 'cosmic-grid';
  let sensitivity = 60;      // 0..100
  let particlesEnabled = true;

  // --- DOM ---
  const $ = id => document.getElementById(id);
  const playPauseButton = $('playPauseButton');
  const skipBackButton = $('skipBackButton');
  const skipForwardButton = $('skipForwardButton');
  const seekBar = $('seekBar');
  const currentTimeDisplay = $('currentTime');
  const totalDurationDisplay = $('totalDuration');
  const visualizerContainer = $('visualizer-container');
  const canvas = $('visualizer-canvas');
  const playlistContainer = $('playlist-items-container');
  const emptyPlaylistMessage = $('empty-playlist-message');
  const messageBar = $('message-bar');
  const currentTrackNameDisplay = $('currentTrackName');
  const volumeSlider = $('volumeSlider');
  const volumeIcon = $('volumeIcon');

  // prevent double wiring in dev/hot-reload
  let _listenersWired = false;

  // --- Init ---
  function init() {
    initThree();
    setupEventListeners();
    setupGlobalShortcuts();
    updateUI();
    animate();
  }

  function initThree() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
      75,
      visualizerContainer.clientWidth / visualizerContainer.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 100;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(visualizerContainer.clientWidth, visualizerContainer.clientHeight);
    renderer.setClearColor(0x000000, 0);

    createVisualizerWeb('cosmic-grid');
    ensureParticlesLayer();
    updateParticlesVisibility();
  }

  function createVisualizerWeb(nextPreset = 'cosmic-grid') {
    if (web) {
      web.geometry?.dispose();
      web.material?.dispose();
      scene.remove(web);
      web = null;
    }

    let baseGeometry, lineColor;
    switch (nextPreset) {
      case 'wave-tunnel':
        baseGeometry = new THREE.TorusKnotGeometry(28, 6, 200, 16);
        lineColor = 0x22d3ee; // cyan
        break;
      case 'particle-burst':
        baseGeometry = new THREE.DodecahedronGeometry(40, 6);
        lineColor = 0xf97316; // orange
        break;
      case 'cosmic-grid':
      default:
        baseGeometry = new THREE.IcosahedronGeometry(40, 8);
        lineColor = 0x4299e1; // blue
        break;
    }

    const edges = new THREE.EdgesGeometry(baseGeometry);
    originalPositions = new Float32Array(edges.attributes.position.array);

    const geometry = new LineGeometry();
    geometry.setPositions(originalPositions);

    const material = new LineMaterial({
      color: lineColor,
      linewidth: 1.5,
      alphaToCoverage: true,
    });
    material.resolution.set(visualizerContainer.clientWidth, visualizerContainer.clientHeight);

    web = new Line2(geometry, material);
    scene.add(web);

    preset = nextPreset;
  }

  function ensureParticlesLayer() {
    if (particles) return;
    const count = 1200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 90 * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ size: 1.2, color: 0xffffff, transparent: true, opacity: 0.6 });
    particles = new THREE.Points(geo, mat);
    scene.add(particles);
  }

  function updateParticlesVisibility() {
    if (particles) particles.visible = !!particlesEnabled;
  }

  function unlockAndInitAudio() {
    if (audioContext) return;

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioElement = new Audio();
      audioElement.volume = volumeSlider.value / 100;

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      dataArray = new Uint8Array(analyser.frequencyBinCount);

      source = audioContext.createMediaElementSource(audioElement);
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      audioElement.addEventListener('play', () => { isPlaying = true; renderPlaylist(); updateUI(); });
      audioElement.addEventListener('pause', () => { isPlaying = false; renderPlaylist(); updateUI(); });
      audioElement.addEventListener('ended', () => loadTrack(currentTrackIndex + 1));
      audioElement.addEventListener('timeupdate', updateSeekBar);
      audioElement.addEventListener('loadedmetadata', updateSeekBar);

      showToast("Audio system ready!", "success");
    } catch (e) {
      console.error("Failed to initialize AudioContext:", e);
      showToast("Error: Could not initialize audio.", "error");
    }
  }

  // --- Events ---
  function setupEventListeners() {
    if (_listenersWired) return;
    _listenersWired = true;

    window.addEventListener('resize', onWindowResize);

    playPauseButton.onclick = togglePlayPause;
    skipBackButton.onclick = () => loadTrack(currentTrackIndex - 1);
    skipForwardButton.onclick = () => loadTrack(currentTrackIndex + 1);

    seekBar.oninput = () => {
      seekBar.style.setProperty('--seek-before-width', `${seekBar.value}%`);
    };
    seekBar.onmousedown = () => { isSeeking = true; };
    seekBar.onmouseup = () => { isSeeking = false; seekToPosition(); };
    seekBar.addEventListener('touchstart', () => { isSeeking = true; });
    seekBar.addEventListener('touchend', () => { isSeeking = false; seekToPosition(); });

    volumeSlider.oninput = handleVolumeChange;

    // Alpine → visualizer
    window.addEventListener('visualizer:sensitivity', (e) => {
      if (typeof e.detail === 'number') {
        sensitivity = clamp(e.detail, 0, 100);
        showToast(`Sensitivity: ${sensitivity}`, 'success');
      }
    });

    window.addEventListener('visualizer:particles', (e) => {
      particlesEnabled = !!e.detail;
      updateParticlesVisibility();
      showToast(particlesEnabled ? 'Particles: on' : 'Particles: off', 'success');
    });

    window.addEventListener('visualizer:preset', (e) => {
      const next = String(e.detail || '').toLowerCase();
      if (['cosmic-grid', 'wave-tunnel', 'particle-burst'].includes(next)) {
        createVisualizerWeb(next);
        showToast(`Preset: ${next}`, 'success');
      }
    });

    // Alpine → playlist
    window.addEventListener('files:added', (e) => {
      const files = Array.isArray(e.detail) ? e.detail : [];
      if (!files.length) return;
      unlockAndInitAudio();
      addFilesArrayToPlaylist(files);
    });

    window.addEventListener('playlist:sort', () => {
      if (!playlist.length) return;

      // Remember current track object (if any), then sort
      const currentTrackObj = currentTrackIndex >= 0 ? playlist[currentTrackIndex] : null;

      playlist.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

      // Re-point currentTrackIndex to the same object at its new position
      if (currentTrackObj) {
        const newIdx = playlist.indexOf(currentTrackObj);
        if (newIdx !== -1) currentTrackIndex = newIdx;
      }

      renderPlaylist();
      showToast('Playlist sorted A–Z', 'success');
    });

    window.addEventListener('playlist:clear', () => {
      stopPlaybackAndClear();
      showToast('Playlist cleared', 'success');
    });
  }

  // --- Global keyboard shortcuts ---
  function setupGlobalShortcuts() {
    const shouldIgnore = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      const editable = el.isContentEditable;
      return editable || tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    window.addEventListener('keydown', (e) => {
      if (shouldIgnore(e.target)) return;

      const k = (e.key || '').toLowerCase();
      switch (k) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'arrowleft':
          e.preventDefault();
          seekBy(-5);
          break;
        case 'arrowright':
          e.preventDefault();
          seekBy(5);
          break;
        case 'arrowup':
          e.preventDefault();
          nudgeVolume(+5);
          break;
        case 'arrowdown':
          e.preventDefault();
          nudgeVolume(-5);
          break;
        case 'n':
          e.preventDefault();
          loadTrack(currentTrackIndex + 1);
          break;
        case 'p':
          e.preventDefault();
          loadTrack(currentTrackIndex - 1);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 's':
          e.preventDefault();
          document.querySelector('button[title="Visualizer Settings"]')?.click();
          break;
        case 't':
          e.preventDefault();
          document.querySelector('button[title="Toggle theme"]')?.click();
          break;
      }
    });
  }

  function seekBy(deltaSeconds) {
    if (!audioElement || !isFinite(audioElement.duration)) return;
    const t = Math.max(0, Math.min(audioElement.currentTime + deltaSeconds, audioElement.duration));
    audioElement.currentTime = t;
  }

  function nudgeVolume(delta) {
    const v = Math.max(0, Math.min(100, parseInt(volumeSlider.value, 10) + delta));
    volumeSlider.value = v;
    handleVolumeChange();
  }

  function toggleMute() {
    if (!audioElement) return;
    if (audioElement.volume > 0) {
      audioElement.dataset.prevVol = volumeSlider.value;
      volumeSlider.value = 0;
    } else {
      const prev = Number(audioElement.dataset.prevVol || 50);
      volumeSlider.value = prev;
    }
    handleVolumeChange();
  }

  function handleVolumeChange() {
    if (audioElement) audioElement.volume = volumeSlider.value / 100;
    const v = volumeSlider.value;
    if (v == 0) volumeIcon.className = 'fas fa-volume-mute text-gray-400';
    else if (v < 50) volumeIcon.className = 'fas fa-volume-down text-gray-400';
    else volumeIcon.className = 'fas fa-volume-up text-gray-400';
  }

  function onWindowResize() {
    if (!visualizerContainer.clientWidth || !visualizerContainer.clientHeight) return;
    camera.aspect = visualizerContainer.clientWidth / visualizerContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(visualizerContainer.clientWidth, visualizerContainer.clientHeight);
    if (web) web.material.resolution.set(visualizerContainer.clientWidth, visualizerContainer.clientHeight);
  }

  // --- Loop ---
  function animate() {
    requestAnimationFrame(animate);

    if (web) {
      web.rotation.y += (preset === 'wave-tunnel' ? 0.002 : 0.001);
      web.rotation.x += 0.0005;
    }
    if (particles?.visible) particles.rotation.y -= 0.0004;

    if (isPlaying && analyser) {
      analyser.getByteFrequencyData(dataArray);
      updateVisualizer(dataArray);
    }
    renderer.render(scene, camera);
  }

  function sensitivityFactor() {
    return 0.25 + (sensitivity / 100) * 1.75;
  }

  function updateVisualizer(data) {
    if (!web || !originalPositions) return;

    const newPositions = new Float32Array(originalPositions.length);
    const bassAvg = avgRange(data, 0, 32);
    const midAvg = avgRange(data, 32, 128);
    const sens = sensitivityFactor();
    const baseDisp = ((bassAvg / 255) * 20 + (midAvg / 255) * 10) * sens;

    for (let i = 0; i < originalPositions.length / 3; i++) {
      const i3 = i * 3;
      const originalVector = new THREE.Vector3(
        originalPositions[i3],
        originalPositions[i3 + 1],
        originalPositions[i3 + 2]
      );
      const direction = originalVector.clone().normalize();
      const newPos = originalVector.clone().add(direction.multiplyScalar(baseDisp));
      newPositions[i3 + 0] = newPos.x;
      newPositions[i3 + 1] = newPos.y;
      newPositions[i3 + 2] = newPos.z;
    }

    web.geometry.setPositions(newPositions);

    const bassIntensity = bassAvg / 255;
    let baseHue = 0.6 - (bassIntensity * 0.6); // blue -> red
    if (preset === 'wave-tunnel') baseHue = 0.55 - (bassIntensity * 0.4);
    if (preset === 'particle-burst') baseHue = 0.07 + (bassIntensity * 0.15);
    web.material.color.setHSL(baseHue, 0.8, 0.5);

    if (particles?.visible) {
      const s = 1 + (midAvg / 255) * 0.15 * sens;
      particles.scale.set(s, s, s);
      particles.material.opacity = 0.35 + (bassIntensity * 0.4);
    }
  }

  function avgRange(array, start, end) {
    const len = Math.max(0, Math.min(end, array.length) - start);
    if (!len) return 0;
    let sum = 0;
    for (let i = start; i < end && i < array.length; i++) sum += array[i];
    return sum / len;
  }

  // --- Playlist ---
  function addFilesArrayToPlaylist(files) {
    // De-dupe by name+size to prevent “double add”
    const existingKeys = new Set(playlist.map(p => `${p.name}::${p.file?.size ?? -1}`));
    for (const file of files) {
      if (!(file && file.name && /\.mp3$/i.test(file.name))) continue;
      const key = `${file.name}::${file.size ?? -1}`;
      if (existingKeys.has(key)) continue; // skip duplicates
      playlist.push({ file, name: file.name, url: URL.createObjectURL(file) });
      existingKeys.add(key);
    }
    renderPlaylist();
    if (currentTrackIndex === -1 && playlist.length > 0) loadTrack(0);
  }

  function removeTrack(index) {
    if (index < 0 || index >= playlist.length) return;

    const removingCurrent = (index === currentTrackIndex);
    try { playlist[index].url && URL.revokeObjectURL(playlist[index].url); } catch {}

    playlist.splice(index, 1);

    if (!playlist.length) {
      stopPlaybackAndClear();
      return;
    }

    if (index < currentTrackIndex) {
      currentTrackIndex -= 1;
    } else if (removingCurrent) {
      if (currentTrackIndex >= playlist.length) currentTrackIndex = 0;
      loadTrack(currentTrackIndex);
      return;
    }

    renderPlaylist();
  }

  function loadTrack(index) {
    if (!playlist.length || !audioContext) return;
    if (index < 0) index = playlist.length - 1;
    if (index >= playlist.length) index = 0;

    currentTrackIndex = index;
    const track = playlist[index];
    currentTrackNameDisplay.textContent = track.name;

    audioElement.src = track.url;
    audioElement.play().catch(e => {
      console.error("Playback error:", e);
      showToast("Error playing audio file.", "error");
    });

    renderPlaylist();
  }

  function togglePlayPause() {
    if (!audioContext) {
      if (playlist.length > 0) {
        unlockAndInitAudio();
        loadTrack(0);
      } else {
        showToast("Please add MP3 files to the playlist first.", "info");
      }
      return;
    }
    if (audioElement.paused) audioElement.play().catch(e => console.error("Playback error:", e));
    else audioElement.pause();
  }

  function stopPlaybackAndClear() {
    if (audioElement) {
      try { audioElement.pause(); } catch {}
      audioElement.removeAttribute('src');
      audioElement.load();
    }
    for (const item of playlist) { if (item.url) URL.revokeObjectURL(item.url); }
    playlist = [];
    currentTrackIndex = -1;
    isPlaying = false;
    renderPlaylist();
    updateUI();
    seekBar.value = 0;
    seekBar.style.setProperty('--seek-before-width', `0%`);
    currentTimeDisplay.textContent = '0:00';
    totalDurationDisplay.textContent = '0:00';
    currentTrackNameDisplay.textContent = 'No song selected';
  }

  function seekToPosition() {
    if (!audioElement || !isFinite(audioElement.duration)) return;
    audioElement.currentTime = (seekBar.value / 100) * audioElement.duration;
  }

  // --- UI helpers ---
  function renderPlaylist() {
    playlistContainer.innerHTML = '';
    const has = playlist.length > 0;

    if (!has) {
      if (emptyPlaylistMessage) emptyPlaylistMessage.style.display = 'block';
    } else {
      if (emptyPlaylistMessage) emptyPlaylistMessage.style.display = 'none';
      playlist.forEach((track, index) => {
        const isCurrent = (index === currentTrackIndex && isPlaying);
        const wrapper = document.createElement('div');
        wrapper.className = `playlist-item group flex items-center gap-3 p-3 rounded-md transition-colors mb-1 ${index === currentTrackIndex ? 'bg-red-500/30' : 'hover:bg-gray-700'}`;
        wrapper.dataset.index = String(index);

        const icon = document.createElement('i');
        icon.className = 'fas fa-music text-gray-400';

        const name = document.createElement('span');
        name.className = 'flex-grow text-white truncate';
        name.textContent = track.name;

        // Small remove button — hidden until hover
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.title = 'Remove from playlist';
        removeBtn.setAttribute('aria-label', 'Remove track');
        removeBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
        removeBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          removeTrack(index);
        });

        const indicator = document.createElement('div');
        indicator.className = 'now-playing-indicator';
        indicator.innerHTML = `<div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>`;

        wrapper.append(icon, name, removeBtn, indicator);
        wrapper.addEventListener('click', () => loadTrack(index));
        if (isCurrent) wrapper.classList.add('playing');

        playlistContainer.appendChild(wrapper);
      });
    }

    try { window.dispatchEvent(new CustomEvent('playlist:state', { detail: { hasTracks: has } })); } catch {}
    updateUI();
  }

  function updateUI() {
    const hasTracks = playlist.length > 0;
    playPauseButton.disabled = !hasTracks;
    skipBackButton.disabled = playlist.length < 2;
    skipForwardButton.disabled = playlist.length < 2;
    seekBar.disabled = !hasTracks;

    playPauseButton.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    if (!hasTracks) currentTrackNameDisplay.textContent = 'No song selected';
  }

  function updateSeekBar() {
    if (!audioElement || !isFinite(audioElement.duration)) return;
    if (!isSeeking) {
      const progress = (audioElement.currentTime / audioElement.duration) * 100;
      seekBar.value = isNaN(progress) ? 0 : progress;
    }
    seekBar.style.setProperty('--seek-before-width', `${seekBar.value}%`);
    currentTimeDisplay.textContent = formatTime(audioElement.currentTime);
    totalDurationDisplay.textContent = formatTime(audioElement.duration);
  }

  function showToast(text, type = 'info') {
    if (!messageBar) return;
    messageBar.textContent = text;
    messageBar.className = 'fixed top-0 left-0 w-full text-white text-center p-3 z-50 font-medium transition-transform duration-300';
    if (type === 'success') messageBar.classList.add('bg-green-600');
    else if (type === 'error') messageBar.classList.add('bg-red-600');
    else messageBar.classList.add('bg-blue-600');

    messageBar.classList.remove('-translate-y-full');
    setTimeout(() => messageBar.classList.add('-translate-y-full'), 1800);
  }

  function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }

  init();
});
