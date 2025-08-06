// FIX: Import Three.js and OrbitControls as ES modules.
// This is the modern approach and prevents loading errors.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

document.addEventListener('DOMContentLoaded', () => {

    // --- Globals ---
    // NOTE: THREE and OrbitControls are now imported as modules, not loaded globally via script tags.
    let scene, camera, renderer, controls, analyser;
    let audioContext, source, audioElement;
    let bars = [];
    let playlist = [], currentTrackIndex = -1;
    let isPlaying = false, isSeeking = false;
    let dataArray;

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
    function init() {
        initThree();
        setupEventListeners();
        updateUI();
        animate();
    }

    function initThree() {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, mainContentArea.clientWidth / mainContentArea.clientHeight, 0.1, 1000);
        camera.position.set(0, 50, 150);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(mainContentArea.clientWidth, mainContentArea.clientHeight);

        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
        directionalLight.position.set(0, 50, 100);
        scene.add(directionalLight);

        // FIX: Use the imported OrbitControls class directly.
        // This resolves the "is not a constructor" error.
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 50;
        controls.maxDistance = 400;
    }

    // This function creates the audio context on the first user click,
    // which is required by modern browsers.
    function unlockAndInitAudio() {
        if (audioContext) return; // Already initialized

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioElement = new Audio();
            
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            const bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);

            source = audioContext.createMediaElementSource(audioElement);
            source.connect(analyser);
            analyser.connect(audioContext.destination);

            buildVisualizerBars(bufferLength);
            
            // Wire up audio element events
            audioElement.addEventListener('play', () => { isPlaying = true; updateUI(); });
            audioElement.addEventListener('pause', () => { isPlaying = false; updateUI(); });
            audioElement.addEventListener('ended', () => loadTrack(currentTrackIndex + 1));
            audioElement.addEventListener('timeupdate', updateSeekBar);
            audioElement.addEventListener('loadedmetadata', updateSeekBar);
            
            showToast("Audio system ready!", "success");

        } catch (e) {
            console.error("Failed to initialize AudioContext:", e);
            showToast("Error: Could not initialize audio.", "error");
        }
    }

    function buildVisualizerBars(barCount) {
        // Clear existing bars if any
        bars.forEach(bar => scene.remove(bar));
        bars = [];

        const barWidth = 2, barGap = 1;
        const totalWidth = barCount * (barWidth + barGap);
        const startX = -totalWidth / 2;
        const material = new THREE.MeshPhongMaterial({ vertexColors: true });

        for (let i = 0; i < barCount; i++) {
            const geometry = new THREE.BoxGeometry(barWidth, 1, barWidth);
            // Create a pleasant color gradient for the bars
            const color = new THREE.Color().setHSL(i / barCount, 0.8, 0.6);
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
        // Also handle touch events for mobile
        seekBar.addEventListener('touchstart', () => { isSeeking = true; });
        seekBar.addEventListener('touchend', () => { isSeeking = false; seekToPosition(); });
    }

    function onWindowResize() {
        if (!mainContentArea.clientWidth || !mainContentArea.clientHeight) return;
        camera.aspect = mainContentArea.clientWidth / mainContentArea.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mainContentArea.clientWidth, mainContentArea.clientHeight);
    }

    // --- Playlist & Playback Logic ---
    function addFilesToPlaylist(event) {
        if (!event.target.files.length) return;
        unlockAndInitAudio(); // Unlock audio on first file add
        
        for (const file of event.target.files) {
            playlist.push({ file: file, name: file.name, url: URL.createObjectURL(file) });
        }
        renderPlaylist();
        
        if (currentTrackIndex === -1 && playlist.length > 0) {
            loadTrack(0);
        }
        
        fileInput.value = null; // Clear input to allow re-adding the same file
    }

    function loadTrack(index) {
        if (!playlist.length || !audioContext) return;

        // Loop the playlist
        if (index < 0) index = playlist.length - 1;
        if (index >= playlist.length) index = 0;
        
        currentTrackIndex = index;
        const track = playlist[index];
        
        audioElement.src = track.url;
        audioElement.volume = volumeSlider.value / 100;
        audioElement.play().catch(e => {
            console.error("Playback error:", e);
            showToast("Error playing audio file.", "error");
        });
        
        renderPlaylist();
    }

    function togglePlayPause() {
        // If audio isn't setup yet and there are tracks, init and play the first one.
        if (!audioContext) {
            if (playlist.length > 0) {
                unlockAndInitAudio();
                loadTrack(0);
            } else {
                showToast("Please add MP3 files to the playlist first.", "info");
            }
            return;
        }
        
        // If audio is ready, toggle play/pause
        if (audioElement.paused) {
            audioElement.play().catch(e => console.error("Playback error:", e));
        } else {
            audioElement.pause();
        }
    }

    function seekToPosition() {
        if (!audioElement || !isFinite(audioElement.duration)) return;
        audioElement.currentTime = (seekBar.value / 100) * audioElement.duration;
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
        updateUI();
    }

    // --- Animation Loop ---
    function animate() {
        requestAnimationFrame(animate);
        controls.update(); // Required for damping to work

        if (isPlaying && analyser) {
            analyser.getByteFrequencyData(dataArray);
            updateVisualizerBars(dataArray);
        } else if (bars.length > 0) {
            // Gently lower bars to zero when paused
            bars.forEach(bar => {
                bar.scale.y += (1 - bar.scale.y) * 0.08; // Animate towards a scale of 1
                bar.position.y = bar.scale.y / 2;
            });
        }
        
        renderer.render(scene, camera);
    }

    function updateVisualizerBars(data) {
        const maxHeight = 150;
        bars.forEach((bar, i) => {
            const percent = data[i] / 255;
            // Use a power curve to make quiet parts more visible and loud parts pop
            const height = 1 + Math.pow(percent, 2.5) * maxHeight;
            // Smoothly animate the bar height
            bar.scale.y += (height - bar.scale.y) * 0.2;
            bar.position.y = bar.scale.y / 2;
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
                item.className = `p-2 rounded-md cursor-pointer transition-colors mb-1 text-sm truncate ${index === currentTrackIndex ? 'bg-indigo-600 text-white font-semibold' : 'hover:bg-gray-700'}`;
                item.textContent = track.name;
                item.title = track.name;
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
        
        playPauseButton.innerHTML = isPlaying ? '<i class="fas fa-pause"></i> Pause' : '<i class="fas fa-play"></i> Play';
    }

    function updateSeekBar() {
        if (isSeeking || !audioElement || !isFinite(audioElement.duration)) return;
        const progress = (audioElement.currentTime / audioElement.duration) * 100;
        seekBar.value = isNaN(progress) ? 0 : progress;
        currentTimeDisplay.textContent = formatTime(audioElement.currentTime);
        totalDurationDisplay.textContent = formatTime(audioElement.duration);
    }
    
    function showToast(text, type = 'info') { // type can be 'success', 'error', 'info'
        messageBar.textContent = text;
        // Reset classes to default before applying new ones
        messageBar.className = 'fixed top-0 left-0 w-full text-white text-center p-3 z-50 font-medium transition-transform duration-300';
        if (type === 'success') messageBar.classList.add('bg-green-600');
        else if (type === 'error') messageBar.classList.add('bg-red-600');
        else messageBar.classList.add('bg-blue-600');

        // Show the bar
        messageBar.classList.remove('-translate-y-full');
        // Hide it after 3 seconds
        setTimeout(() => {
            messageBar.classList.add('-translate-y-full');
        }, 3000);
    }

    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    // --- Start the app ---
    init();
});
