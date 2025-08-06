// --- Globals ---
// Note: No more imports. THREE and OrbitControls are now global.
let scene, camera, renderer, controls, analyser;
let audioContext, source, audioElement;
let bars = [];
let playlist = [], currentTrackIndex = -1;
let isPlaying = false, isSeeking = false;
let bufferLength, dataArray;

// --- DOM Elements ---
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

// --- Initialization ---
(function init() {
    initThree();
    setupEventListeners();
    renderPlaylist();
    animate();
})();

function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, mainContentArea.clientWidth / mainContentArea.clientHeight, 0.1, 1000);
    camera.position.set(0, 75, 200);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mainContentArea.clientWidth, mainContentArea.clientHeight);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(0, 50, 100);
    scene.add(directionalLight);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
}

// **FIX**: This function creates the audio context and analyser on the first user click.
// This is the most reliable way to handle browser audio security policies.
function unlockAndInitAudio() {
    if (audioContext) return; // Already initialized

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioElement = new Audio();
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        source = audioContext.createMediaElementSource(audioElement);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        // Now that the audio system is ready, we can build the visualizer bars
        buildVisualizerBars();
        
        // Wire up audio element events
        audioElement.addEventListener('play', () => { isPlaying = true; updateUI(); });
        audioElement.addEventListener('pause', () => { isPlaying = false; updateUI(); });
        audioElement.addEventListener('ended', () => loadTrack(currentTrackIndex + 1));
        audioElement.addEventListener('timeupdate', updateSeekBar);
        audioElement.addEventListener('loadedmetadata', updateSeekBar);

    } catch (e) {
        console.error("Failed to initialize AudioContext:", e);
        showToast("Error: Could not initialize audio.", false);
    }
}

function buildVisualizerBars() {
    const barCount = analyser.frequencyBinCount;
    const barWidth = 2, barGap = 1;
    const totalWidth = barCount * (barWidth + barGap);
    const startX = -totalWidth / 2;
    const material = new THREE.MeshPhongMaterial({ vertexColors: true });

    for (let i = 0; i < barCount; i++) {
        const geometry = new THREE.BoxGeometry(barWidth, 1, barWidth);
        const color = new THREE.Color().setHSL(i / barCount, 1, 0.5);
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let j = 0; j < colors.length; j += 3) {
            colors[j] = color.r;
            colors[j + 1] = color.g;
            colors[j + 2] = color.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const bar = new THREE.Mesh(geometry, material);
        bar.position.set(startX + i * (barWidth + barGap), 0, 0);
        scene.add(bar);
        bars.push(bar);
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    window.addEventListener('resize', onWindowResize);
    fileInput.onchange = addFilesToPlaylist;
    playPauseButton.onclick = togglePlayPause;
    skipBackButton.onclick = () => loadTrack(currentTrackIndex - 1);
    skipForwardButton.onclick = () => loadTrack(currentTrackIndex + 1);
    volumeSlider.oninput = () => { if (audioElement) audioElement.volume = volumeSlider.value / 100; };
    clearPlaylistButton.onclick = clearPlaylist;

    seekBar.onmousedown = () => { isSeeking = true; };
    seekBar.onmouseup = () => { isSeeking = false; seekToPosition(); };
}

function onWindowResize() {
    camera.aspect = mainContentArea.clientWidth / mainContentArea.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mainContentArea.clientWidth, mainContentArea.clientHeight);
}

// --- Playlist & Playback Logic ---
function addFilesToPlaylist(event) {
    if (!event.target.files.length) return;
    for (const file of event.target.files) {
        playlist.push({ file: file, name: file.name, url: URL.createObjectURL(file) });
    }
    renderPlaylist();
    fileInput.value = null;
}

function loadTrack(index) {
    if (!playlist.length) return;
    unlockAndInitAudio(); // Ensure audio is ready

    if (index < 0) index = playlist.length - 1;
    if (index >= playlist.length) index = 0;
    
    currentTrackIndex = index;
    const track = playlist[index];
    
    audioElement.src = track.url;
    audioElement.volume = volumeSlider.value / 100;
    audioElement.play().catch(e => console.error("Playback error:", e));
    
    renderPlaylist();
}

function togglePlayPause() {
    if (!audioContext) { // If first play click
        if (playlist.length > 0) loadTrack(0);
    } else {
        if (audioElement.paused) {
            audioElement.play().catch(e => console.error("Playback error:", e));
        } else {
            audioElement.pause();
        }
    }
}

function seekToPosition() {
    if (!audioElement || !isFinite(audioElement.duration)) return;
    audioElement.currentTime = (seekBar.value / 100) * audioElement.duration;
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    if (isPlaying && analyser) {
        analyser.getByteFrequencyData(dataArray);
        updateVisualizerBars(dataArray);
    }
    
    renderer.render(scene, camera);
}

function updateVisualizerBars(data) {
    const maxHeight = 200;
    bars.forEach((bar, i) => {
        const percent = data[i] / 255;
        const height = 1 + Math.pow(percent, 2) * maxHeight;
        bar.scale.y = height;
        bar.position.y = height / 2;
    });
}

// --- UI Helpers ---
function renderPlaylist() {
    playlistContainer.innerHTML = '';
    if (!playlist.length) {
        emptyPlaylistMessage.style.display = 'block';
    } else {
        emptyPlaylistMessage.style.display = 'none';
        playlist.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = `p-2 rounded-md cursor-pointer transition-colors mb-1 ${index === currentTrackIndex ? 'bg-indigo-600' : 'hover:bg-gray-700'}`;
            item.textContent = track.name;
            item.onclick = () => loadTrack(index);
            playlistContainer.appendChild(item);
        });
    }
    updateUI();
}

function updateUI() {
    const hasTracks = playlist.length > 0;
    playPauseButton.disabled = !hasTracks;
    skipBackButton.disabled = playlist.length < 2;
    skipForwardButton.disabled = playlist.length < 2;
    seekBar.disabled = !hasTracks;
    clearPlaylistButton.disabled = !hasTracks;
    playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
}

function updateSeekBar() {
    if (isSeeking || !audioElement || !isFinite(audioElement.duration)) return;
    seekBar.value = (audioElement.currentTime / audioElement.duration) * 100;
    currentTimeDisplay.textContent = formatTime(audioElement.currentTime);
    totalDurationDisplay.textContent = formatTime(audioElement.duration);
}

function clearPlaylist() {
    if (audioElement) audioElement.pause();
    playlist.forEach(track => URL.revokeObjectURL(track.url));
    playlist = [];
    currentTrackIndex = -1;
    isPlaying = false;
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
