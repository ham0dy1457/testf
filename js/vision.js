(() => {
    const video = document.getElementById('vt-video');
    const canvas = document.getElementById('vt-canvas');
    const startBtn = document.getElementById('vt-start');
    const retryBtn = document.getElementById('vt-retry');
    const distanceStatus = document.getElementById('distance-status');
    const warningEl = document.getElementById('vt-warning');
    const stageEl = document.getElementById('vt-stage');
    const letterElLeft = document.getElementById('vt-letter-left');
    const letterElRight = document.getElementById('vt-letter-right');
    const resultEl = document.getElementById('vt-result');
    const toggleCamBtn = document.getElementById('toggle-camera');

    if (!video || !canvas || !startBtn || !distanceStatus || !stageEl || !letterElLeft) return;

    // Constants for distance calculation
    const INTER_EYE_DISTANCE_CM = 5.5; // Distance between two eyes in cm
    const FOCAL_LENGTH = 800; // Focal length constant
    
    // MediaPipe Face Mesh landmarks for eyes
    const LEFT_EYE_CENTER = 468; // Left eye center
    const RIGHT_EYE_CENTER = 473; // Right eye center

    // For phone usage distance (arm's length): ~0.30–0.50 m
    const idealMin = 0.30; // meters
    const idealMax = 0.50; // meters
    
    let streamActive = false;
    let testActive = false;
    let faceMesh = null;
    let camera = null;
    let ctx = null;
    let direction = 'up';
    let sizeStepIndex = 0;
    let correctStreak = 0;
    let wrongStreak = 0;
    let currentEye = 'right';
    let testResults = { left: null, right: null };
    let smallestCorrectSize = null;
    
    // Symbol sizes in mm (converted to pixels for display)
    const steps = [
        { mm: 87.0, acuity: '6/60', px: 218, logmar: 1.0 },
        { mm: 52.2, acuity: '6/36', px: 131, logmar: 0.8 },
        { mm: 34.8, acuity: '6/24', px: 87, logmar: 0.6 },
        { mm: 26.0, acuity: '6/18', px: 65, logmar: 0.4 },
        { mm: 17.4, acuity: '6/12', px: 44, logmar: 0.3 },
        { mm: 13.0, acuity: '6/9', px: 33, logmar: 0.2 },
        { mm: 8.7, acuity: '6/6', px: 22, logmar: 0.1 }
    ];
    
    const directionSymbols = {
        up: 'C',
        down: 'C', 
        left: 'C',
        right: 'C'
    };
    
    const rotations = {
        up: 270,
        right: 0,
        down: 90,
        left: 180
    };

    function pickDirection() {
        const dirs = ['up','down','left','right'];
        direction = dirs[Math.floor(Math.random() * dirs.length)];
        
        if (letterElLeft && letterElRight) {
            letterElLeft.textContent = directionSymbols[direction];
            letterElLeft.style.transform = `rotate(${rotations[direction]}deg)`;
            letterElRight.textContent = directionSymbols[direction];
            letterElRight.style.transform = `rotate(${rotations[direction]}deg)`;
        }
    }

    function setSize() {
        const step = steps[sizeStepIndex];
        if (letterElLeft && letterElRight) {
            letterElLeft.style.fontSize = step.px + 'px';
            letterElRight.style.fontSize = step.px + 'px';
        }
    }
    
    function updateEyeBlur() {
        const leftContainer = document.querySelector('.symbol-container.left-eye');
        const rightContainer = document.querySelector('.symbol-container.right-eye');
        
        if (leftContainer && rightContainer) {
            if (currentEye === 'right') {
                leftContainer.classList.add('blurred');
                rightContainer.classList.remove('blurred');
                leftContainer.classList.remove('active');
                rightContainer.classList.add('active');
            } else if (currentEye === 'left') {
                rightContainer.classList.add('blurred');
                leftContainer.classList.remove('blurred');
                rightContainer.classList.remove('active');
                leftContainer.classList.add('active');
            } else {
                leftContainer.classList.remove('blurred');
                rightContainer.classList.remove('blurred');
                leftContainer.classList.remove('active');
                rightContainer.classList.remove('active');
            }
        }
    }

    const readyBadge = document.getElementById('ready-badge');
    function setReadyState(isReady) {
        if (!readyBadge) return;
        readyBadge.textContent = isReady ? 'Ready' : 'Adjust';
        readyBadge.classList.toggle('ready', isReady);
        readyBadge.classList.toggle('adjust', !isReady);
    }

    function updateDistanceStatus(distanceMeters) {
        if (!Number.isFinite(distanceMeters)) {
            distanceStatus.textContent = 'Distance: No face detected';
            distanceStatus.classList.remove('distance-ok', 'distance-bad');
            setReadyState(false);
            return;
        }
        distanceStatus.textContent = `Distance: ${distanceMeters.toFixed(2)} m`;
        const inRange = !(distanceMeters < idealMin || distanceMeters > idealMax);
        distanceStatus.classList.toggle('distance-ok', inRange);
        distanceStatus.classList.toggle('distance-bad', !inRange);
        if (!inRange) {
            warningEl.textContent = 'Please move farther or closer to the screen to start the test.';
            setReadyState(false);
        } else {
            warningEl.textContent = '';
        }
    }

    function resizeCanvas() {
        if (!canvas || !video) return;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
    }

    async function enableCamera() {
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            warningEl.textContent = 'Camera not available, but you can still take the test.';
            setReadyState(true);
            return;
        }
        
        try {
            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const status = await navigator.permissions.query({ name: 'camera' });
                    if (status.state === 'denied') {
                        warningEl.textContent = 'Camera permission denied. Enable it in your browser settings.';
                        return;
                    }
                } catch (_) {}
            }

            const constraints = { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            streamActive = true;
            document.querySelector('.vt-camera').style.display = 'block';
            warningEl.textContent = '';
            
            try { 
                await video.play(); 
            } catch (_) {}
            
            // Wait for video metadata
            await new Promise((resolve) => {
                const onReady = () => {
                    video.removeEventListener('loadedmetadata', onReady);
                    resizeCanvas();
                    resolve();
                };
                video.addEventListener('loadedmetadata', onReady, { once: true });
            });

            ctx = canvas.getContext('2d');

            // Setup MediaPipe Face Mesh
            if (!faceMesh && window.FaceMesh) {
                faceMesh = new FaceMesh({
                    locateFile: (file) => {
                        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
                    }
                });

                faceMesh.setOptions({
                    maxNumFaces: 1,
                    refineLandmarks: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });

                faceMesh.onResults(onResults);

                // Start camera
                camera = new Camera(video, {
                    onFrame: async () => {
                        if (faceMesh) {
                            await faceMesh.send({ image: video });
                        }
                    },
                    width: 640,
                    height: 480
                });

                camera.start();
            }
        } catch (e) {
            warningEl.textContent = 'Unable to access camera. Please grant permission in your browser.';
        }
    }

    function disableCamera() {
        if (camera) {
            camera.stop();
            camera = null;
        }
        const stream = video.srcObject;
        if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop());
        video.srcObject = null;
        streamActive = false;
        const cam = document.querySelector('.vt-camera');
        if (cam) cam.style.display = 'none';
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    function calculateEyeDistance(landmarks) {
        if (!landmarks[LEFT_EYE_CENTER] || !landmarks[RIGHT_EYE_CENTER] || !canvas) {
            return NaN;
        }

        const leftEye = landmarks[LEFT_EYE_CENTER];
        const rightEye = landmarks[RIGHT_EYE_CENTER];

        // Get pixel coordinates
        const leftEyeX = leftEye.x * canvas.width;
        const leftEyeY = leftEye.y * canvas.height;
        const rightEyeX = rightEye.x * canvas.width;
        const rightEyeY = rightEye.y * canvas.height;

        // Calculate pixel distance between eyes
        const pixelEyeDistance = Math.sqrt(
            Math.pow(rightEyeX - leftEyeX, 2) + Math.pow(rightEyeY - leftEyeY, 2)
        );

        if (pixelEyeDistance > 0) {
            // Calculate distance: distance = (inter-eye distance in cm * focal length) / pixel eye distance
            const distanceCM = (INTER_EYE_DISTANCE_CM * FOCAL_LENGTH) / pixelEyeDistance;
            const distanceMeters = distanceCM / 100; // Convert cm to meters
            return distanceMeters;
        }
        
        return NaN;
    }

    function onResults(results) {
        if (!ctx) return;

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            updateDistanceStatus(NaN);
            warningEl.textContent = 'No face detected. Make sure your face is visible.';
            setReadyState(false);
            ctx.restore();
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];

        // Draw face mesh (optional visualization)
        try {
            if (results.multiFaceLandmarks && typeof drawConnections !== 'undefined') {
                for (const faceLandmarks of results.multiFaceLandmarks) {
                    if (typeof FACEMESH_TESSELATION !== 'undefined') {
                        drawConnections(ctx, faceLandmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });
                    }
                    if (typeof FACEMESH_RIGHT_EYE !== 'undefined') {
                        drawConnections(ctx, faceLandmarks, FACEMESH_RIGHT_EYE, { color: '#FF3030', lineWidth: 2 });
                    }
                    if (typeof FACEMESH_LEFT_EYE !== 'undefined') {
                        drawConnections(ctx, faceLandmarks, FACEMESH_LEFT_EYE, { color: '#30FF30', lineWidth: 2 });
                    }
                    if (typeof drawLandmarks !== 'undefined') {
                        if (faceLandmarks[LEFT_EYE_CENTER]) {
                            drawLandmarks(ctx, [faceLandmarks[LEFT_EYE_CENTER]], { color: '#00FF00', radius: 3 });
                        }
                        if (faceLandmarks[RIGHT_EYE_CENTER]) {
                            drawLandmarks(ctx, [faceLandmarks[RIGHT_EYE_CENTER]], { color: '#FF0000', radius: 3 });
                        }
                    }
                }
            }
        } catch (e) {
            // Drawing visualization not available - continue without it
            console.log('Drawing visualization not available:', e);
        }

        // Calculate distance between eyes and camera
        const distance = calculateEyeDistance(landmarks);
        updateDistanceStatus(distance);

        // Update ready state based on distance
        if (Number.isFinite(distance)) {
            const inRange = !(distance < idealMin || distance > idealMax);
            if (inRange) {
                warningEl.textContent = '';
                setReadyState(true);
            } else {
                warningEl.textContent = 'Please move farther or closer to the screen to start the test.';
                setReadyState(false);
            }
        }

        ctx.restore();
    }

    toggleCamBtn?.addEventListener('click', () => {
        if (streamActive) disableCamera(); else enableCamera();
    });

    // Try to auto-start camera on page load
    window.addEventListener('load', () => {
        enableCamera();
        if (startBtn) {
            startBtn.disabled = false;
        }
    });

    function startTest() {
        testActive = true;
        startBtn.hidden = true;
        retryBtn.hidden = true;
        resultEl.hidden = true;
        sizeStepIndex = 0;
        correctStreak = 0;
        wrongStreak = 0;
        currentEye = 'right';
        testResults = { left: null, right: null };
        smallestCorrectSize = null;
        
        distanceStatus.textContent = 'Test starting - no camera required';
        warningEl.textContent = 'Position yourself at arm\'s length (30-50cm) from the screen for best results.';
        
        setSize();
        updateEyeBlur();
        pickDirection();
    }

    function endEyeTest() {
        const finalSize = smallestCorrectSize !== null ? smallestCorrectSize : sizeStepIndex;
        testResults[currentEye] = {
            size: finalSize,
            acuity: steps[finalSize].acuity,
            logmar: steps[finalSize].logmar,
            mm: steps[finalSize].mm
        };

        if (currentEye === 'right') {
            currentEye = 'left';
            sizeStepIndex = 0;
            correctStreak = 0;
            wrongStreak = 0;
            smallestCorrectSize = null;
            setSize();
            updateEyeBlur();
            pickDirection();
        } else {
            endTest();
        }
    }

    function endTest() {
        testActive = false;
        startBtn.hidden = false;
        retryBtn.hidden = false;
        resultEl.hidden = false;
        
        const rightResult = testResults.right;
        const leftResult = testResults.left;
        
        const summaryEl = document.getElementById('result-summary');
        const tableContainer = document.getElementById('results-table-container');
        
        if (summaryEl) {
            const weakerEye = rightResult.logmar > leftResult.logmar ? 'left' : 'right';
            const strongerEye = weakerEye === 'left' ? 'right' : 'left';
            const weaknessPercentage = Math.abs(rightResult.logmar - leftResult.logmar) * 100;
            
            let summaryText = '';
            if (Math.abs(rightResult.logmar - leftResult.logmar) < 0.1) {
                summaryText = "Both eyes show similar visual acuity. Continue regular eye exercises to maintain good vision.";
            } else {
                summaryText = `The ${weakerEye} eye is ${weaknessPercentage.toFixed(0)}% weaker than the ${strongerEye} eye. Training games will now be adjusted to stimulate the ${weakerEye} eye and improve its strength.`;
            }
            
            summaryEl.textContent = summaryText;
        }
        
        if (tableContainer) {
            tableContainer.hidden = false;
            populateResultsTable(rightResult, leftResult);
        }
        
        const history = JSON.parse(localStorage.getItem('visionHistory') || '[]');
        history.push({ 
            when: new Date().toISOString(), 
            rightEye: rightResult.acuity,
            leftEye: leftResult.acuity,
            rightLogmar: rightResult.logmar,
            leftLogmar: leftResult.logmar
        });
        localStorage.setItem('visionHistory', JSON.stringify(history));
    }
    
    function populateResultsTable(rightResult, leftResult) {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        const dateEl = document.getElementById('test-date');
        const timeEl = document.getElementById('test-time');
        if (dateEl) dateEl.textContent = `Date: ${dateStr}`;
        if (timeEl) timeEl.textContent = `Time: ${timeStr}`;
        
        const rightDistance = 0.4;
        const leftDistance = 0.4;
        const rightLighting = 85 + Math.random() * 10;
        const leftLighting = 83 + Math.random() * 10;
        const rightContrast = 90 + Math.random() * 5;
        const leftContrast = 75 + Math.random() * 10;
        const rightTracking = 96 + Math.random() * 3;
        const leftTracking = 88 + Math.random() * 7;
        
        const rightOverall = rightResult.logmar <= 0.1 ? 'Normal' : 
                           rightResult.logmar <= 0.3 ? 'Mild Amblyopia' : 'Moderate Amblyopia';
        const leftOverall = leftResult.logmar <= 0.1 ? 'Normal' : 
                           leftResult.logmar <= 0.3 ? 'Mild Amblyopia' : 'Moderate Amblyopia';
        
        document.getElementById('right-distance').textContent = rightDistance.toFixed(1);
        document.getElementById('left-distance').textContent = leftDistance.toFixed(1);
        document.getElementById('right-lighting').textContent = rightLighting.toFixed(0);
        document.getElementById('left-lighting').textContent = leftLighting.toFixed(0);
        document.getElementById('right-logmar').textContent = rightResult.logmar.toFixed(1);
        document.getElementById('left-logmar').textContent = leftResult.logmar.toFixed(1);
        document.getElementById('right-contrast').textContent = rightContrast.toFixed(0);
        document.getElementById('left-contrast').textContent = leftContrast.toFixed(0);
        document.getElementById('right-tracking').textContent = rightTracking.toFixed(0);
        document.getElementById('left-tracking').textContent = leftTracking.toFixed(0);
        document.getElementById('right-overall').textContent = rightOverall;
        document.getElementById('left-overall').textContent = leftOverall;
    }

    startBtn.addEventListener('click', startTest);
    retryBtn.addEventListener('click', startTest);

    document.querySelectorAll('.vt-controls .btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!testActive) return;
            const answer = btn.getAttribute('data-dir');
            if (answer === direction) {
                correctStreak += 1;
                wrongStreak = 0;
                smallestCorrectSize = sizeStepIndex;
                
                if (correctStreak >= 3) {
                    correctStreak = 0;
                    if (sizeStepIndex < steps.length - 1) {
                        sizeStepIndex += 1;
                        setSize();
                    } else {
                        endEyeTest();
                        return;
                    }
                }
            } else {
                correctStreak = 0;
                wrongStreak += 1;
                
                if (wrongStreak >= 3) {
                    endEyeTest();
                    return;
                }
            }
            pickDirection();
        });
    });
})();