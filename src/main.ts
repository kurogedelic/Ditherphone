import * as THREE from 'three';
import * as Tone from 'tone';

// ============================================
// Configuration
// ============================================
const CONFIG = {
  // Dot pattern settings
  dotSize: 0.8,           // Dot size
  dotSpacing: 1.0,        // Dot spacing
  baseResolution: 80,     // Base resolution (horizontal dot count)
  resolutionX: 80,        // Grid resolution (horizontal) - auto-set from camera
  resolutionY: 45,        // Grid resolution (vertical) - auto-set from camera

  // Posterize settings
  colorLevels: 6,         // Color quantization level

  // Morphing settings
  morphSpeed: 0.5,        // Morphing speed
  colorChangeSpeed: 0.3,  // Color change speed
  mouseInfluenceRadius: 15, // Mouse influence radius
  mouseInfluenceStrength: 0.8, // Mouse influence strength

  // Particle settings
  particleSize: 0.6,      // Size as particles

  // Audio settings
  numVoices: 8,          // Number of voices
  audioEnabled: true,     // Audio enabled/disabled
};

// ============================================
// Shaders
// ============================================
const DOT_VERTEX_SHADER = `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uMouseActive;
  uniform sampler2D uVideoTexture;
  uniform sampler2D uMotionTexture;
  uniform float uDotSize;
  uniform float uDotSpacing;
  uniform vec2 uResolution;

  varying vec3 vColor;
  varying float vMorphFactor;
  varying vec2 vUv;

  // Simple noise function
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vUv = uv;

    // Original grid position
    vec2 originalPos = position.xy;

    // Sample motion texture (get video motion, vertically flipped)
    float motionAmount = 0.0;
    vec2 motionUv = vec2(uv.x, 1.0 - uv.y); // Flip vertical only
    vec4 motionSample = texture2D(uMotionTexture, motionUv);
    motionAmount = motionSample.r;

    // Mouse influence
    float distToMouse = distance(originalPos, uMouse);
    float mouseInfluence = smoothstep(
      ${CONFIG.mouseInfluenceRadius.toFixed(1)},
      0.0,
      distToMouse
    ) * uMouseActive;

    // Position variation by motion (morph with video motion)
    float motionInfluence = motionAmount * 15.0; // Emphasize motion
    vec2 motionDirection = vec2(
      sin(uTime * 3.0 + uv.x * 6.28),
      cos(uTime * 3.0 + uv.y * 6.28)
    );
    vec2 motionOffset = motionDirection * motionInfluence;

    // Position variation by noise (auto morphing over time)
    float timeScale = uTime * ${CONFIG.morphSpeed.toFixed(1)};
    float noiseOffset = noise(originalPos * 0.1 + timeScale) * 1.0;

    // Position variation by mouse
    vec2 mouseDirection = normalize(uMouse - originalPos);
    vec2 mouseOffset = mouseDirection * mouseInfluence * 5.0;

    // Noise-based morphing
    vec2 noiseMorphOffset = vec2(
      sin(timeScale + originalPos.x * 0.1) * noiseOffset,
      cos(timeScale + originalPos.y * 0.1) * noiseOffset
    );

    // Final position (motion + mouse + noise)
    vec2 gridPos = originalPos + motionOffset + mouseOffset + noiseMorphOffset;
    vec3 pos = vec3(gridPos, 0.0);

    // Sample color from camera video (natural orientation)
    vec2 videoUv = uv;
    vec4 videoColor = texture2D(uVideoTexture, videoUv);

    // Posterize
    float levels = ${CONFIG.colorLevels.toFixed(1)};
    vec3 quantizedColor = floor(videoColor.rgb * levels) / levels;

    // Color shift over time
    float timeFactor = uTime * ${CONFIG.colorChangeSpeed.toFixed(1)};
    vec3 timeShiftedColor = quantizedColor;
    timeShiftedColor.r += sin(timeFactor + uv.x * 3.14159 * 2.0) * 0.05;
    timeShiftedColor.g += cos(timeFactor + uv.y * 3.14159 * 2.0) * 0.05;
    timeShiftedColor.b += sin(timeFactor * 0.7) * 0.05;

    // Color shift by motion
    vec3 motionColorShift = vec3(motionAmount) * vec3(0.3, 0.5, 1.0);

    // Color morphing around mouse
    vec3 mouseColorShift = vec3(
      sin(uTime * 2.0 + distToMouse * 0.5) * 0.5 + 0.5,
      cos(uTime * 1.5 + distToMouse * 0.3) * 0.5 + 0.5,
      sin(uTime * 1.0 + distToMouse * 0.7) * 0.5 + 0.5
    );

    vec3 finalColor = mix(timeShiftedColor + motionColorShift, mouseColorShift, mouseInfluence * ${CONFIG.mouseInfluenceStrength.toFixed(1)});
    finalColor = clamp(finalColor, 0.0, 1.0);

    vColor = finalColor;
    vMorphFactor = mouseInfluence + motionInfluence;

    // Size variation by morphing
    float sizeVariation = 1.0 + mouseInfluence * 0.5 + motionInfluence * 0.3 + sin(uTime * 3.0 + uv.x * 10.0) * 0.2;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = uDotSize * sizeVariation * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const DOT_FRAGMENT_SHADER = `
  uniform float uTime;

  varying vec3 vColor;
  varying float vMorphFactor;
  varying vec2 vUv;

  void main() {
    // Create circular dots
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    // Smooth edges
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);

    if (alpha < 0.01) discard;

    // Specular effect by morphing
    float specular = smoothstep(0.4, 0.0, dist) * vMorphFactor;

    vec3 finalColor = vColor + specular * 0.3;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ============================================
// Main Class
// ============================================
class QuantumDotsApp {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private dotsMesh: THREE.Points | null = null;
  private videoElement: HTMLVideoElement;
  private videoTexture: THREE.VideoTexture;
  private mouse: THREE.Vector2 = new THREE.Vector2(-1000, -1000);
  private mouseActive: number = 0;
  private startTime: number = Date.now();
  private shaderMaterial: THREE.ShaderMaterial;

  // For motion detection
  private motionWorker: Worker | null = null;
  private motionCanvas: HTMLCanvasElement | null = null;
  private motionCtx: CanvasRenderingContext2D | null = null;
  private prevFrameData: ImageData | null = null;
  private motionTexture: THREE.DataTexture | null = null;
  private motionAnalysisInterval: number = 50; // ms (shorter for smoother)
  private lastMotionAnalysis: number = 0;
  private motionDecay: number = 0.05; // Decay rate (motion disappearance speed)

  // For audio
  private audioInitialized: boolean = false;
  private voices: Array<{
    osc: Tone.Oscillator;
    filter: Tone.BiquadFilter;
    gain: Tone.Gain;
  }> = [];
  private distortion: Tone.Distortion | null = null;
  private reverb: Tone.Reverb | null = null;
  private limiter: Tone.Limiter | null = null;
  private audioEnabled: boolean = false;

  // For motion blur
  private fadePlane: THREE.Mesh | null = null;
  private fadeScene: THREE.Scene | null = null;
  private fadeCamera: THREE.OrthographicCamera | null = null;

  constructor() {
    // Initialize scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // Camera setup
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);

    // Set initial camera position (temporary value as resolution is unknown)
    this.camera.position.z = 60;

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // No antialiasing for motion blur
      alpha: false,
      preserveDrawingBuffer: true // Preserve buffer for motion blur
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false; // Disable auto clear for motion blur
    document.body.appendChild(this.renderer.domElement);

    // Setup fade plane for motion blur
    this.setupMotionBlur();

    // Video element (hidden, only texture used)
    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.style.display = 'none'; // Hidden
    document.body.appendChild(this.videoElement);

    // Video texture
    this.videoTexture = new THREE.VideoTexture(this.videoElement);
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;

    // Shader material
    this.shaderMaterial = new THREE.ShaderMaterial({
      vertexShader: DOT_VERTEX_SHADER,
      fragmentShader: DOT_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: this.mouse },
        uMouseActive: { value: 0 },
        uVideoTexture: { value: this.videoTexture },
        uMotionTexture: { value: null },
        uDotSize: { value: CONFIG.dotSize },
        uDotSpacing: { value: CONFIG.dotSpacing },
        uResolution: { value: new THREE.Vector2(CONFIG.resolutionX, CONFIG.resolutionY) }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    // Initialize motion detection
    this.initMotionDetection();

    // Initialize audio (executed after user interaction)
    document.addEventListener('click', () => this.initAudio(), { once: true });
    document.addEventListener('touchstart', () => this.initAudio(), { once: true });

    // Event listeners
    this.setupEventListeners();

    // Start camera
    this.startCamera();

    // Start animation
    this.animate();
  }

  private setupMotionBlur(): void {
    // Scene and camera for fade
    this.fadeScene = new THREE.Scene();
    this.fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Fullscreen black plane (semi-transparent)
    const fadeGeometry = new THREE.PlaneGeometry(2, 2);
    const fadeMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.12 // Smaller value = longer persistence (stronger motion blur)
    });

    this.fadePlane = new THREE.Mesh(fadeGeometry, fadeMaterial);
    this.fadePlane.position.z = -1;
    this.fadeScene.add(this.fadePlane);
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.onResize());

    // Vectors for raycasting (reused)
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const target = new THREE.Vector3();

    document.addEventListener('mousemove', (e) => {
      // Convert mouse position to Normalized Device Coordinates (NDC)
      mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

      // Calculate intersection with Z=0 plane using raycasting
      raycaster.setFromCamera(mouseNDC, this.camera);
      raycaster.ray.intersectPlane(plane, target);

      this.mouse.copy(target);
      this.mouseActive = 1.0;
    });

    document.addEventListener('mouseleave', () => {
      this.mouseActive = 0.0;
    });

    document.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      mouseNDC.x = (touch.clientX / window.innerWidth) * 2 - 1;
      mouseNDC.y = -(touch.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouseNDC, this.camera);
      raycaster.ray.intersectPlane(plane, target);

      this.mouse.copy(target);
      this.mouseActive = 1.0;
    }, { passive: false });

    document.addEventListener('touchend', () => {
      this.mouseActive = 0.0;
    });
  }

  private initMotionDetection(): void {
    // Create worker for motion detection
    try {
      const workerBlob = new Blob([`
        let accumulatedMotion = null;

        self.onmessage = (e) => {
          const { prevFrame, currentFrame, threshold, width, height, decay } = e.data;

          if (!prevFrame) {
            accumulatedMotion = new Float32Array(width * height).fill(0);
            self.postMessage({ motionMap: accumulatedMotion.buffer }, [accumulatedMotion.buffer]);
            return;
          }

          const prevData = new Uint8ClampedArray(prevFrame);
          const currData = new Uint8ClampedArray(currentFrame);

          // 初期化
          if (!accumulatedMotion || accumulatedMotion.length !== width * height) {
            accumulatedMotion = new Float32Array(width * height).fill(0);
          }

          // 現在のフレームの動きを検出
          for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            const rDiff = Math.abs(currData[idx] - prevData[idx]);
            const gDiff = Math.abs(currData[idx + 1] - prevData[idx + 1]);
            const bDiff = Math.abs(currData[idx + 2] - prevData[idx + 2]);
            const totalDiff = (rDiff + gDiff + bDiff) / 3;

            // Accumulate motion
            if (totalDiff > threshold) {
              accumulatedMotion[i] = Math.min(accumulatedMotion[i] + totalDiff / 255.0, 1.0);
            }
          }

          // Decay (gradually remove previous motion)
          for (let i = 0; i < width * height; i++) {
            accumulatedMotion[i] = Math.max(accumulatedMotion[i] - decay, 0.0);
          }

          self.postMessage({ motionMap: accumulatedMotion.buffer }, [accumulatedMotion.buffer]);
          accumulatedMotion = null; // 転送後はnullに（所有権が移動）
        };
      `], { type: 'application/javascript' });

      this.motionWorker = new Worker(URL.createObjectURL(workerBlob));

      this.motionWorker.onmessage = (e) => {
        if (e.data.motionMap && this.motionTexture) {
          const motionData = new Float32Array(e.data.motionMap);
          this.motionTexture.image.data = motionData;
          this.motionTexture.needsUpdate = true;
        }
      };
    } catch (error) {
      console.warn('Worker initialization failed:', error);
    }

    // Canvas for motion texture (resolution set dynamically)
    this.motionCanvas = document.createElement('canvas');
    this.updateMotionCanvasSize();

    this.motionCtx = this.motionCanvas.getContext('2d', { willReadFrequently: true });

    // Create motion texture (resolution set dynamically)
    this.updateMotionTexture();
  }

  private updateMotionCanvasSize(): void {
    if (!this.motionCanvas) return;
    this.motionCanvas.width = CONFIG.resolutionX;
    this.motionCanvas.height = CONFIG.resolutionY;
  }

  private updateMotionTexture(): void {
    if (this.motionTexture) {
      this.motionTexture.dispose();
    }

    const motionData = new Float32Array(CONFIG.resolutionX * CONFIG.resolutionY).fill(0);
    this.motionTexture = new THREE.DataTexture(
      motionData,
      CONFIG.resolutionX,
      CONFIG.resolutionY,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.motionTexture.minFilter = THREE.LinearFilter;
    this.motionTexture.magFilter = THREE.LinearFilter;
    this.shaderMaterial.uniforms.uMotionTexture.value = this.motionTexture;
  }

  private updateMotionDetection(): void {
    if (!this.motionCtx || !this.videoElement || this.videoElement.videoWidth === 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastMotionAnalysis < this.motionAnalysisInterval) {
      return;
    }
    this.lastMotionAnalysis = now;

    // Capture current frame
    this.motionCtx.drawImage(
      this.videoElement,
      0, 0,
      CONFIG.resolutionX,
      CONFIG.resolutionY
    );

    const currentFrame = this.motionCtx.getImageData(
      0, 0,
      CONFIG.resolutionX,
      CONFIG.resolutionY
    );

    // Send to worker to calculate frame difference
    if (this.motionWorker && this.prevFrameData) {
      this.motionWorker.postMessage({
        prevFrame: this.prevFrameData.data.buffer,
        currentFrame: currentFrame.data.buffer,
        threshold: 20,
        width: CONFIG.resolutionX,
        height: CONFIG.resolutionY,
        decay: this.motionDecay
      }, [this.prevFrameData.data.buffer, currentFrame.data.buffer]);
    }

    // Save current frame (for next comparison)
    this.prevFrameData = this.motionCtx.getImageData(
      0, 0,
      CONFIG.resolutionX,
      CONFIG.resolutionY
    );
  }

  private async initAudio(): Promise<void> {
    if (this.audioInitialized) return;

    try {
      await Tone.start();

      // Effect chain: Distortion → Reverb → Limiter → Destination
      this.distortion = new Tone.Distortion(0.8).toDestination();
      this.reverb = new Tone.Reverb({ decay: 4, wet: 0.5 }).connect(this.distortion);
      this.limiter = new Tone.Limiter(-6).connect(this.reverb);

      // Create voices
      for (let i = 0; i < CONFIG.numVoices; i++) {
        const osc = new Tone.Oscillator(0, 'sawtooth').start();
        const filter = new Tone.BiquadFilter({
          type: 'lowpass',
          frequency: 440,
          Q: 1
        });
        const gain = new Tone.Gain(0);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.limiter!);

        this.voices.push({ osc, filter, gain });
      }

      this.audioInitialized = true;
      this.audioEnabled = true;
      console.log('Audio initialized');
    } catch (error) {
      console.error('Audio initialization failed:', error);
    }
  }

  private updateAudioFromMotion(): void {
    if (!this.audioInitialized || !this.audioEnabled || !this.motionTexture) {
      return;
    }

    // Get data from motion texture
    const motionData = this.motionTexture.image.data as Float32Array;
    const width = CONFIG.resolutionX;
    const height = CONFIG.resolutionY;

    // Physical size of grid
    const gridWidth = width * CONFIG.dotSpacing;
    const gridHeight = height * CONFIG.dotSpacing;

    // Divide into 8 bins
    const binWidth = gridWidth / CONFIG.numVoices;
    const binStats = Array.from({ length: CONFIG.numVoices }, () => ({
      count: 0,
      sumY: 0,
      sumBrightness: 0
    }));

    // Calculate statistics for all dots
    for (let i = 0; i < motionData.length; i++) {
      const brightness = motionData[i];

      // Process only dots with motion
      if (brightness > 0.01) {
        const x = (i % width) * CONFIG.dotSpacing;
        const y = Math.floor(i / width) * CONFIG.dotSpacing;

        // Calculate bin index
        const binIndex = Math.min(Math.floor(x / binWidth), CONFIG.numVoices - 1);

        binStats[binIndex].count++;
        binStats[binIndex].sumY += y;
        binStats[binIndex].sumBrightness += brightness;
      }
    }

    // Reflect to audio
    const now = Tone.now();
    binStats.forEach((stat, i) => {
      const voice = this.voices[i];

      if (stat.count > 0) {
        const avgY = stat.sumY / stat.count;
        const avgB = stat.sumBrightness / stat.count;

        // Convert Y coordinate to frequency (higher at top, lower at bottom)
        // Grid Y ranges from -gridHeight/2 to gridHeight/2
        const normalizedY = (avgY + gridHeight / 2) / gridHeight; // 0~1
        const freq = Tone.Frequency(120 + normalizedY * 60).toFrequency();

        // Convert brightness (motion intensity) to Q value
        const qValue = avgB * 30 + 1;

        // Convert density to volume
        const volume = Math.min(stat.count / 100, 0.3);

        voice.osc.frequency.rampTo(freq, 0.1);
        voice.filter.Q.rampTo(qValue, 0.1);
        voice.gain.gain.rampTo(volume, 0.1);
      } else {
        // Silence if no motion
        voice.gain.gain.rampTo(0, 0.1);
      }
    });
  }

  private async startCamera(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });

      this.videoElement.srcObject = stream;

      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        this.videoElement.addEventListener('loadeddata', () => {
          console.log('Video loaded, dimensions:', this.videoElement.videoWidth, 'x', this.videoElement.videoHeight);

          // Adjust resolution based on camera aspect ratio
          const videoWidth = this.videoElement.videoWidth;
          const videoHeight = this.videoElement.videoHeight;
          const aspectRatio = videoWidth / videoHeight;

          CONFIG.resolutionX = CONFIG.baseResolution;
          CONFIG.resolutionY = Math.round(CONFIG.baseResolution / aspectRatio);

          console.log(`Adjusted grid resolution: ${CONFIG.resolutionX}x${CONFIG.resolutionY} (aspect: ${aspectRatio.toFixed(2)})`);

          resolve();
        }, { once: true });
      });

      await this.videoElement.play();

      // Wait a bit before creating dot pattern (wait for first video frame)
      setTimeout(() => {
        this.createDotPattern();
        this.updateCameraPosition(); // Also update camera position
      }, 500);

    } catch (error) {
      console.error('Camera access error:', error);
      alert('Could not access camera. Please allow camera permission.');
    }
  }

  private createDotPattern(): void {
    // Remove old mesh
    if (this.dotsMesh) {
      this.scene.remove(this.dotsMesh);
      this.dotsMesh.geometry.dispose();
      (this.dotsMesh.material as THREE.Material).dispose();
    }

    // Create grid based on resolution
    const resX = CONFIG.resolutionX;
    const resY = CONFIG.resolutionY;
    const totalDots = resX * resY;

    // Geometry
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];

    // Create grid centered at origin
    const halfSizeX = resX / 2;
    const halfSizeY = resY / 2;
    const spacing = CONFIG.dotSpacing;

    for (let i = 0; i < resX; i++) {
      for (let j = 0; j < resY; j++) {
        // Position on grid
        const x = (i - halfSizeX) * spacing;
        const y = (j - halfSizeY) * spacing;
        const z = 0;

        positions.push(x, y, z);

        // UV coordinates (for video texture)
        const u = i / (resX - 1);
        const v = j / (resY - 1);
        uvs.push(u, v);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

    // Use as point material
    const pointsMaterial = new THREE.ShaderMaterial({
      vertexShader: DOT_VERTEX_SHADER,
      fragmentShader: DOT_FRAGMENT_SHADER,
      uniforms: this.shaderMaterial.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    // Create point system
    this.dotsMesh = new THREE.Points(geometry, pointsMaterial);
    this.scene.add(this.dotsMesh);

    // Also update motion detection canvas and texture
    this.updateMotionCanvasSize();
    this.updateMotionTexture();

    // Update resolution uniform
    this.shaderMaterial.uniforms.uResolution.value.set(CONFIG.resolutionX, CONFIG.resolutionY);

    console.log(`Created ${totalDots} dots (${resX}x${resY})`);
  }

  private updateCameraPosition(): void {
    // Calculate camera position based on grid size
    const gridWidth = CONFIG.resolutionX * CONFIG.dotSpacing;
    const gridHeight = CONFIG.resolutionY * CONFIG.dotSpacing;
    const maxDimension = Math.max(gridWidth, gridHeight);

    // Calculate distance to see entire grid at 50° FOV
    const fovRad = 50 * (Math.PI / 180);
    const cameraDistance = (maxDimension / 2) / Math.tan(fovRad / 2) * 0.7; // 0.7x for zoomed display

    this.camera.position.z = cameraDistance;
    console.log(`Camera distance: ${cameraDistance.toFixed(2)}, Grid: ${gridWidth}x${gridHeight}`);
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    const currentTime = (Date.now() - this.startTime) / 1000;

    // Update motion detection
    this.updateMotionDetection();

    // Update audio
    this.updateAudioFromMotion();

    // Update shader uniforms
    this.shaderMaterial.uniforms.uTime.value = currentTime;
    this.shaderMaterial.uniforms.uMouse.value = this.mouse;
    this.shaderMaterial.uniforms.uMouseActive.value = THREE.MathUtils.lerp(
      this.shaderMaterial.uniforms.uMouseActive.value as number,
      this.mouseActive,
      0.1
    );

    // Motion blur: fade previous frame with semi-transparent black
    if (this.fadeScene && this.fadeCamera) {
      this.renderer.render(this.fadeScene, this.fadeCamera);
    }

    // Clear depth buffer
    this.renderer.clearDepth();

    // Render scene
    this.renderer.render(this.scene, this.camera);
  }
}

// ============================================
// App Startup
// ============================================
window.addEventListener('load', () => {
  const app = new QuantumDotsApp();
});
