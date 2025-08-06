import * as THREE from 'three';

document.addEventListener('DOMContentLoaded', () => {

    // --- Globals ---
    let scene, camera, renderer, analyser;
    let audioContext, source, audioElement;
    let playlist = [], currentTrackIndex = -1;
    let isPlaying = false, isSeeking = false;
    let dataArray;
    
    // Visualizer objects
    let particleSystem;
    let originalPositions; // To store the base position of vertices

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
    const visualizerContainer = $('visualizer-container');
    const canvas = $('visualizer-canvas');
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
        
        camera = new THREE.PerspectiveCamera(75, visualizerContainer.clientWidth / visualizerContainer.clientHeight, 0.1, 1000);
        camera.position.z = 120;

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(visualizerContainer.clientWidth, visualizerContainer.clientHeight);

        scene.add(new THREE.AmbientLight(0xffffff, 0.2));
        
        createVisualizerWeb();
    }

    function createVisualizerWeb() {
        // Use a sphere geometry with many vertices to create the web effect
        const geometry = new THREE.SphereGeometry(50, 64, 64);
        
        // Store the original vertex positions for the animation
        originalPositions = new Float32Array(geometry.attributes.position.array);

        // A material for the lines
        const material = new THREE.LineBasicMaterial({
            color: 0x0099ff, // A nice blue color
            transparent: true,
            opacity: 0.6
        });

        // Create line segments to connect the vertices
        particleSystem = new THREE.LineSegments(geometry, material);
        scene.add(particleSystem);
    }

    function unlockAndInitAudio() {
        if (audioContext) return; 

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioElement = new Audio();
            
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 512; // More data points for a more detailed reaction
            const bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);

            source = audioContext.createMediaElementSource(audioElement);
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            
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
        seekBar.addEventListener('touchstart', () => { isSeeking = true; });
        seekBar.addEventListener('touchend', () => { isSeeking = false; seekToPosition(); });
    }

    function onWindowResize() {
        if (!visualizerContainer.clientWidth || !visualizerContainer.clientHeight) return;
        camera.aspect = visualizerContainer.clientWidth / visualizerContainer.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(visualizerContainer.clientWidth, visualizerContainer.clientHeight);
    }

    // --- Animation Loop ---
    function animate() {
        requestAnimationFrame(animate);

        if (isPlaying && analyser && particleSystem) {
            analyser.getByteFrequencyData(dataArray);
            updateVisualizerWeb(dataArray);
        } else if (particleSystem) {
            // Gently return to base state when paused
            particleSystem.rotation.y += 0.0005;
        }
        
        renderer.render(scene, camera);
    }

    function updateVisualizerWeb(data) {
        const positions = particleSystem.geometry.attributes.position.array;
        const vertexCount = positions.length / 3;

        // Animate the vertices
        for (let i = 0; i < vertexCount; i++) {
            const i3 = i * 3;
            
            // Get original position to calculate direction
            const ox = originalPositions[i3];
            const oy = originalPositions[i3 + 1];
            const oz = originalPositions[i3 + 2];

            // Create a normalized direction vector
            const direction = new THREE.Vector3(ox, oy, oz).normalize();

            // Map the vertex index to a data array index
            const dataIndex = Math.floor(i / (vertexCount / data.length)) % data.length;
            const magnitude = data[dataIndex];

            // Calculate the displacement
            const displacement = magnitude / 255 * 20; // Max displacement of 20 units

            // Apply the displacement along the direction vector
            positions[i3] = ox + direction.x * displacement;
            positions[i3 + 1] = oy + direction.y * displacement;
            positions[i3 + 2] = oz + direction.z * displacement;
        }

        // Tell Three.js that the positions have been updated
        particleSystem.geometry.attributes.position.needsUpdate = true;

        // Rotate the whole system
        particleSystem.rotation.y += 0.001;
        
        // Change color based on overall volume
        const overallAvg = data.reduce((a, b) => a + b, 0) / data.length;
        const colorIntensity = overallAvg / 255;
        particleSystem.material.color.setHSL(0.55 + colorIntensity * 0.1, 1.0, 0.5);
    }

    // --- Playlist & Playback Logic (Unchanged) ---
    function addFilesToPlaylist(event) {
        if (!event.target.files.length) return;
        unlockAndInitAudio(); 
        
        for (const file of event.target.files) {
            playlist.push({ file: file, name: file.name, url: URL.createObjectURL(file) });
        }
        renderPlaylist();
        
        if (currentTrackIndex === -1 && playlist.length > 0) {
            loadTrack(0);
        }
        
        fileInput.value = null;
    }

    function loadTrack(index) {
        if (!playlist.length || !audioContext) return;

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
        if (!audioContext) {
            if (playlist.length > 0) {
                unlockAndInitAudio();
                loadTrack(0);
            } else {
                showToast("Please add MP3 files to the playlist first.", "info");
            }
            return;
        }
        
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

    // --- UI Helpers (Unchanged) ---
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
        
        playPauseButton.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    }

    function updateSeekBar() {
        if (isSeeking || !audioElement || !isFinite(audioElement.duration)) return;
        const progress = (audioElement.currentTime / audioElement.duration) * 100;
        seekBar.value = isNaN(progress) ? 0 : progress;
        currentTimeDisplay.textContent = formatTime(audioElement.currentTime);
        totalDurationDisplay.textContent = formatTime(audioElement.duration);
    }
    
    function showToast(text, type = 'info') {
        messageBar.textContent = text;
        messageBar.className = 'fixed top-0 left-0 w-full text-white text-center p-3 z-50 font-medium transition-transform duration-300';
        if (type === 'success') messageBar.classList.add('bg-green-600');
        else if (type === 'error') messageBar.classList.add('bg-red-600');
        else messageBar.classList.add('bg-blue-600');

        messageBar.classList.remove('-translate-y-full');
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
