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
    // FIX: Removed the volumeSlider constant as the element no longer exists
    const seekBar = $('seekBar');
    const currentTimeDisplay = $('currentTime');
    const totalDurationDisplay = $('totalDuration');
    const visualizerContainer = $('visualizer-container');
    const canvas = $('visualizer-canvas');
    const playlistContainer = $('playlist-items-container');
    const emptyPlaylistMessage = $('empty-playlist-message');
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
        const geometry = new THREE.SphereGeometry(50, 64, 64);
        originalPositions = new Float32Array(geometry.attributes.position.array);
        const material = new THREE.LineBasicMaterial({
            color: 0x0099ff,
            transparent: true,
            opacity: 0.6
        });
        particleSystem = new THREE.LineSegments(geometry, material);
        scene.add(particleSystem);
    }

    function unlockAndInitAudio() {
        if (audioContext) return; 

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioElement = new Audio();
            audioElement.volume = 0.5; // Set a default volume
            
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            const bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);

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

    // --- Event Listeners ---
    function setupEventListeners() {
        window.addEventListener('resize', onWindowResize);
        fileInput.onchange = addFilesToPlaylist;
        playPauseButton.onclick = togglePlayPause;
        skipBackButton.onclick = () => loadTrack(currentTrackIndex - 1);
        skipForwardButton.onclick = () => loadTrack(currentTrackIndex + 1);
        
        // FIX: Removed event listener for the non-existent volume slider
        
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
            particleSystem.rotation.y += 0.0005;
        }
        
        renderer.render(scene, camera);
    }

    function updateVisualizerWeb(data) {
        const positions = particleSystem.geometry.attributes.position.array;
        const vertexCount = positions.length / 3;

        for (let i = 0; i < vertexCount; i++) {
            const i3 = i * 3;
            const direction = new THREE.Vector3(originalPositions[i3], originalPositions[i3 + 1], originalPositions[i3 + 2]).normalize();
            const dataIndex = Math.floor(i / (vertexCount / data.length)) % data.length;
            const magnitude = data[dataIndex];
            const displacement = magnitude / 255 * 20;
            positions[i3] = originalPositions[i3] + direction.x * displacement;
            positions[i3 + 1] = originalPositions[i3 + 1] + direction.y * displacement;
            positions[i3 + 2] = originalPositions[i3 + 2] + direction.z * displacement;
        }
        particleSystem.geometry.attributes.position.needsUpdate = true;
        particleSystem.rotation.y += 0.001;
        
        const overallAvg = data.reduce((a, b) => a + b, 0) / data.length;
        const colorIntensity = overallAvg / 255;
        particleSystem.material.color.setHSL(0.55 + colorIntensity * 0.1, 1.0, 0.5);
    }

    // --- Playlist & Playback Logic ---
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

    // --- UI Helpers ---
    function renderPlaylist() {
        playlistContainer.innerHTML = '';
        if (!playlist.length) {
            emptyPlaylistMessage.style.display = 'block';
        } else {
            emptyPlaylistMessage.style.display = 'none';
            playlist.forEach((track, index) => {
                const isCurrentlyPlaying = (index === currentTrackIndex && isPlaying);
                const itemClasses = `playlist-item flex items-center gap-4 p-3 rounded-md cursor-pointer transition-colors mb-1 ${index === currentTrackIndex ? 'bg-indigo-600/30' : 'hover:bg-gray-700'}`;
                
                const itemHTML = `
                    <div class="${itemClasses}" data-index="${index}">
                        <i class="fas fa-music text-gray-400"></i>
                        <span class="flex-grow text-white truncate">${track.name}</span>
                        <div class="now-playing-indicator">
                            <div class="bar"></div>
                            <div class="bar"></div>
                            <div class="bar"></div>
                            <div class="bar"></div>
                        </div>
                    </div>
                `;
                const itemEl = document.createElement('div');
                itemEl.innerHTML = itemHTML;
                itemEl.querySelector('.playlist-item').addEventListener('click', () => loadTrack(index));

                if (isCurrentlyPlaying) {
                    itemEl.querySelector('.playlist-item').classList.add('playing');
                }

                playlistContainer.appendChild(itemEl.firstElementChild);
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
