import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ---------- globals ---------- */
let scene, camera, renderer, analyser, audio, ctx, listener;
let controls, bars = [];
let playlist = [], currentTrackIndex = -1;
let isPlaying = false, isLoading = false;
let playbackStartTime = 0, pausedTime = 0, isSeeking = false;

/* ---------- dom ---------- */
const $ = id => document.getElementById(id);
const fileInput = $('audioFileInput');
const playPauseButton = $('playPauseButton');
const skipBackButton = $('skipBackButton');
const skipForwardButton = $('skipForwardButton');
const volumeSlider = $('volumeSlider');
const seekBar = $('seekBar');
const currentTimeDisplay = $('currentTime');
const totalDurationDisplay = $('totalDuration');
const canvas = $('visualizer-canvas');
const mainContentArea = $('main-content-area');
const playlistContainer = $('playlist-items-container');
const emptyPlaylistMessage = $('empty-playlist-message');
const clearPlaylistButton = $('clear-playlist-button');
const messageBar = $('message-bar');

/* ---------- boot ---------- */
// Self-invoking function to initialize the application
(function init() {
  initThree();
  initAudio();
  buildVisualizerBars();
  setupEventListeners();
  renderPlaylist();
  animate();
})();

/* ---------- three.js setup ---------- */
function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, mainContentArea.clientWidth / mainContentArea.clientHeight, 0.1, 1000);
  camera.position.set(0, 75, 200);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(mainContentArea.clientWidth, mainContentArea.clientHeight);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
  directionalLight.position.set(0, 50, 100);
  scene.add(directionalLight);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
}

/* ---------- audio setup ---------- */
function initAudio() {
  // **FIX**: Added a try...catch block to expose any audio initialization errors.
  try {
    listener = new THREE.AudioListener();
    ctx = listener.context;
    camera.add(listener);

    audio = new THREE.Audio(listener);
    audio.setVolume(volumeSlider.value / 100);

    // Manually create a serial audio graph:
    // The audio signal will flow from the source, through the analyser, then to the speakers.
    audio.gain.disconnect();
    analyser = new THREE.AudioAnalyser(audio, 512);
    analyser.analyser.connect(listener.getInput());
  } catch(e) {
    console.error("Audio init failed:", e);
    // Display a permanent error message to the user.
    showToast("Error: Audio system failed to start. Please try refreshing.", false);
  }
}


/**
 * Creates the geometric bars for the visualizer.
 */
function buildVisualizerBars() {
  const barCount = analyser.frequencyBinCount; // 256 bars
  const barWidth = 2;
  const barGap = 1;
  const totalWidth = barCount * (barWidth + barGap);
  const startX = -totalWidth / 2;
  
  const material = new THREE.MeshPhongMaterial({ vertexColors: true });

  for (let i = 0; i < barCount; i++) {
    const geometry = new THREE.BoxGeometry(barWidth, 1, barWidth);
    
    // Assign a unique color to each bar based on its position
    const color = new THREE.Color().setHSL(i / barCount, 1, 0.5);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for(let j = 0; j < colors.length; j += 3) {
        colors[j] = color.r;
        colors[j+1] = color.g;
        colors[j+2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const bar = new THREE.Mesh(geometry, material);
    bar.position.set(startX + i * (barWidth + barGap), 0, 0);
    scene.add(bar);
    bars.push(bar);
  }
}

/* ---------- UI event listeners ---------- */
function setupEventListeners() {
  window.addEventListener('resize', onWindowResize);
  fileInput.onchange = addFilesToPlaylist;
  playPauseButton.onclick = togglePlayPause;
  skipBackButton.onclick = () => loadTrack(currentTrackIndex - 1);
  skipForwardButton.onclick = () => loadTrack(currentTrackIndex + 1);
  volumeSlider.oninput = () => audio.setVolume(volumeSlider.value / 100);
  clearPlaylistButton.onclick = clearPlaylist;

  // Seek bar interaction
  seekBar.onmousedown = () => { isSeeking = true; };
  seekBar.onmouseup = () => { 
    isSeeking = false; 
    seekToPosition(); 
  };
  seekBar.oninput = () => {
    if (isSeeking && audio.buffer) {
      const time = (seekBar.value / 100) * audio.buffer.duration;
      currentTimeDisplay.textContent = formatTime(time);
    }
  };
}

function onWindowResize() {
    camera.aspect = mainContentArea.clientWidth / mainContentArea.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mainContentArea.clientWidth, mainContentArea.clientHeight);
}

/* ---------- playlist management ---------- */
function addFilesToPlaylist(event) {
  if (!event.target.files.length) return;
  
  // Do not auto-play. Just add files to the playlist.
  // The user must click "Play" to start the audio context.
  for (const file of event.target.files) {
    playlist.push({ file: file, name: file.name });
  }
  
  renderPlaylist();
  fileInput.value = null; // Reset file input to allow selecting the same file again
}

async function loadTrack(index) {
  if (isLoading || !playlist.length) return;

  // Resume audio context if it was suspended. This is crucial.
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  // Loop playlist
  if (index < 0) {
    index = playlist.length - 1;
  } else if (index >= playlist.length) {
    index = 0;
  }
  
  if (audio.isPlaying) {
    audio.stop();
  }

  isLoading = true;
  isPlaying = false;
  currentTrackIndex = index;
  pausedTime = 0; 
  seekBar.value = 0; 
  renderPlaylist();
  updateUI();

  try {
    const file = playlist[index].file;
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    
    audio.setBuffer(audioBuffer);
    isLoading = false;
    play();
  } catch (error) {
    console.error("Error loading track:", error);
    showToast(`Error loading ${playlist[index].name}`);
    isLoading = false;
    renderPlaylist(); // Re-render to remove "Loading..." state
  }
}

/* ---------- playback controls ---------- */
function togglePlayPause() {
  // If no track is selected yet, load the first one.
  if (currentTrackIndex === -1 && playlist.length > 0) {
    loadTrack(0);
  } else {
    isPlaying ? pause() : play();
  }
}

function play() {
  if (!audio.buffer || isLoading) return;
  
  audio.offset = pausedTime;
  audio.play();
  playbackStartTime = ctx.currentTime - pausedTime;
  isPlaying = true;
  updateUI();
}

function pause() {
  if (!isPlaying) return;
  
  pausedTime = ctx.currentTime - playbackStartTime;
  audio.pause();
  isPlaying = false;
  updateUI();
}

function seekToPosition() {
  if (!audio.buffer) return;
  const wasPlaying = isPlaying;
  
  if (wasPlaying) {
    audio.stop();
  }
  
  pausedTime = (seekBar.value / 100) * audio.buffer.duration;
  
  if (wasPlaying) {
    play();
  }
}

/* ---------- animation loop ---------- */
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  if (isPlaying) {
    const frequencyData = analyser.getFrequencyData();
    updateVisualizerBars(frequencyData);

    if (!isSeeking && audio.buffer) {
      const elapsedTime = ctx.currentTime - playbackStartTime;
      if (isFinite(audio.buffer.duration)) {
          seekBar.value = (elapsedTime / audio.buffer.duration) * 100;
          currentTimeDisplay.textContent = formatTime(elapsedTime);
          totalDurationDisplay.textContent = formatTime(audio.buffer.duration);
          
          // Auto-play next track
          if (elapsedTime >= audio.buffer.duration) {
              loadTrack(currentTrackIndex + 1);
          }
      }
    }
  }
  renderer.render(scene, camera);
}

function updateVisualizerBars(data) {
  const maxHeight = 200; // Max height for a bar
  bars.forEach((bar, i) => {
    const percent = data[i] / 255; // Value between 0 and 1
    const height = 1 + Math.pow(percent, 2) * maxHeight; // Use power curve for more dynamic feel
    bar.scale.y = height;
    bar.position.y = height / 2;
  });
}

/* ---------- helper functions ---------- */
function renderPlaylist() {
  playlistContainer.innerHTML = '';
  if (!playlist.length) {
    emptyPlaylistMessage.style.display = 'block';
    playlistContainer.appendChild(emptyPlaylistMessage);
  } else {
    emptyPlaylistMessage.style.display = 'none';
    playlist.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = 'playlist-item';
      if (index === currentTrackIndex) {
        item.classList.add('active-track');
      }
      item.textContent = (index === currentTrackIndex && isLoading) ? 'Loading…' : track.name;
      item.onclick = () => loadTrack(index);
      playlistContainer.appendChild(item);
    });
  }
  updateUI();
}

function updateUI() {
  const hasTracks = playlist.length > 0;
  playPauseButton.disabled = !hasTracks || isLoading;
  skipBackButton.disabled = playlist.length < 2 || isLoading;
  skipForwardButton.disabled = playlist.length < 2 || isLoading;
  seekBar.disabled = !hasTracks || isLoading;
  clearPlaylistButton.disabled = !hasTracks;
  playPauseButton.textContent = isLoading ? 'Loading…' : (isPlaying ? 'Pause' : 'Play');
}

function clearPlaylist() {
  if (isPlaying) {
    audio.stop();
  }
  playlist = [];
  currentTrackIndex = -1;
  isPlaying = false;
  pausedTime = 0;
  seekBar.value = 0;
  currentTimeDisplay.textContent = '0:00';
  totalDurationDisplay.textContent = '0:00';
  renderPlaylist();
}

function showToast(text, autoHide = true) {
  messageBar.textContent = text;
  messageBar.style.display = 'block';
  if (autoHide) {
    setTimeout(() => { messageBar.style.display = 'none'; }, 4000);
  }
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
