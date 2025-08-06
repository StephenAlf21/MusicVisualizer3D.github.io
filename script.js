import * as THREE from 'three';
// Import additional modules for rendering thick lines
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
    
    // Visualizer objects
    let web; 
    let originalPositions; 

    // --- DOM Elements ---
    const $ = id => document.getElementById(id);
    const fileInput = $('audioFileInput');
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
        camera.position.z = 100;

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(visualizerContainer.clientWidth, visualizerContainer.clientHeight);
        renderer.setClearColor(0x000000, 0);

        createVisualizerWeb();
    }

    function createVisualizerWeb() {
        // 1. Create the base shape and get its edges
        const baseGeometry = new THREE.IcosahedronGeometry(40, 8);
        const edges = new THREE.EdgesGeometry(baseGeometry);
        originalPositions = new Float32Array(edges.attributes.position.array);

        // 2. Create a LineGeometry for the thick lines
        const geometry = new LineGeometry();
        geometry.setPositions(originalPositions);

        // 3. Create the special material for thick lines
        const material = new LineMaterial({
            color: 0x4299e1,
            linewidth: 1.5, // Control the thickness here (in pixels)
            vertexColors: false,
            dashed: false,
            alphaToCoverage: true, // For smoother edges
        });
        // The material needs to know the screen resolution
        material.resolution.set(visualizerContainer.clientWidth, visualizerContainer.clientHeight);

        // 4. Create the Line2 object
        web = new Line2(geometry, material);
        scene.add(web);
    }

    function unlockAndInitAudio() {
        if (audioContext) return; 

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioElement = new Audio();
            audioElement.volume = volumeSlider.value / 100;
            
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
        
        seekBar.oninput = () => {
            const progress = seekBar.value;
            seekBar.style.setProperty('--seek-before-width', `${progress}%`);
        };
        seekBar.onmousedown = () => { isSeeking = true; };
        seekBar.onmouseup = () => { isSeeking = false; seekToPosition(); };
        seekBar.addEventListener('touchstart', () => { isSeeking = true; });
        seekBar.addEventListener('touchend', () => { isSeeking = false; seekToPosition(); });

        volumeSlider.oninput = handleVolumeChange;
    }
    
    function handleVolumeChange() {
        if(audioElement) {
            audioElement.volume = volumeSlider.value / 100;
        }
        const volume = volumeSlider.value;
        if (volume == 0) {
            volumeIcon.className = 'fas fa-volume-mute text-gray-400';
        } else if (volume < 50) {
            volumeIcon.className = 'fas fa-volume-down text-gray-400';
        } else {
            volumeIcon.className = 'fas fa-volume-up text-gray-400';
        }
    }

    function onWindowResize() {
        if (!visualizerContainer.clientWidth || !visualizerContainer.clientHeight) return;
        camera.aspect = visualizerContainer.clientWidth / visualizerContainer.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(visualizerContainer.clientWidth, visualizerContainer.clientHeight);
        
        // Update the material resolution on resize
        if (web) {
            web.material.resolution.set(visualizerContainer.clientWidth, visualizerContainer.clientHeight);
        }
    }

    // --- Animation Loop ---
    function animate() {
        requestAnimationFrame(animate);

        if (web) {
            web.rotation.y += 0.001;
            web.rotation.x += 0.0005;
        }

        if (isPlaying && analyser) {
            analyser.getByteFrequencyData(dataArray);
            updateVisualizer(dataArray);
        }
        
        renderer.render(scene, camera);
    }

    function updateVisualizer(data) {
        // Create a new array for the updated vertex positions
        const newPositions = new Float32Array(originalPositions.length);
        
        const bassAvg = data.slice(0, 32).reduce((a, b) => a + b, 0) / 32;
        const midAvg = data.slice(32, 128).reduce((a, b) => a + b, 0) / 96;

        for (let i = 0; i < originalPositions.length / 3; i++) {
            const i3 = i * 3;
            const originalVector = new THREE.Vector3(originalPositions[i3], originalPositions[i3+1], originalPositions[i3+2]);
            const direction = originalVector.clone().normalize();
            
            const displacement = (bassAvg / 255) * 20 + (midAvg / 255) * 10;

            const newPos = originalVector.clone().add(direction.multiplyScalar(displacement));
            newPositions[i3] = newPos.x;
            newPositions[i3 + 1] = newPos.y;
            newPositions[i3 + 2] = newPos.z;
        }

        // Update the geometry and color of the lines
        web.geometry.setPositions(newPositions);
        
        const bassIntensity = bassAvg / 255;
        const hue = 0.6 - (bassIntensity * 0.6); // Blue -> Red
        web.material.color.setHSL(hue, 0.8, 0.5);
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
                const itemClasses = `playlist-item flex items-center gap-4 p-3 rounded-md cursor-pointer transition-colors mb-1 ${index === currentTrackIndex ? 'bg-red-500/30' : 'hover:bg-gray-700'}`;
                
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
        if (!hasTracks) {
            currentTrackNameDisplay.textContent = 'No song selected';
        }
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
