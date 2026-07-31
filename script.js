// =========================================================================
// AUTHENTIC GOOGLE MAPS 3D AR LIVE VIEW NAVIGATION SYSTEM (ULTIMATE EDITION)
// =========================================================================

// --- 3D Scene Globals ---
let scene, camera, renderer, controls;
let userLat = null, userLon = null;
let targetLat = null, targetLon = null;
let destinationObject = null;
let pathLineMesh = null;
let pathArrows = [];
let maxArrows = 18;
let arrowSpacing = 2.2; // meters
let hasStarted = false;

// Constant Ground Plane Elevation (eye-level camera at y=0, ground at y=-1.6m)
const GROUND_Y = -1.6;

// --- GPS Kalman Filter & Accuracy State ---
let kf = {
    R: 10, Q: 0.1, A: 1, B: 0, C: 1,
    lat: null, lon: null,
    covLat: NaN, covLon: NaN
};
let rawGpsAccuracy = 10;
let accuracyCircleMarker = null;

// --- Leaflet Minimap & Picker Globals ---
let leafletMap = null;
let userMarker = null;
let userFovCone = null;
let targetMarker = null;
let mapRouteLine = null;
let maneuverMapMarkers = [];
let isMapExpanded = false;
let isHeadingUp = true; // Google Maps default: Map rotates with heading
let currentTileLayer = null;
let mapTileStyle = 'street'; // 'street', 'satellite', 'dark'

let pickerMap = null;
let pickerMarker = null;
let pickerUserMarker = null;
let _selectedLat = null, _selectedLon = null;

// --- Turn-by-Turn Routing & Step Engine ---
let routeCoordinates = []; // GeoJSON [lon, lat] points
let routeSteps = [];       // Maneuver step objects from OSRM
let currentStepIndex = 0;  // Active step maneuver index
let routeCurve = null;     // THREE.CatmullRomCurve3
let routeLength = 0;       // Length of visible track
let totalRouteDistance = 0; // Total distance in meters
let totalRouteDuration = 0; // Total duration in seconds
const VISIBLE_PATH_AHEAD = 50; // Meters of visible path rendered in AR view

// --- Voice & Settings State ---
let voiceEnabled = true;
let lastSpokenText = "";
let speechSynth = window.speechSynthesis || null;

// --- Simulation Engine State ---
let simulationActive = false;
let simulationTimer = null;
let simStepIndex = 0;

// --- Orientation & Compass State ---
let compassHeading = null;
let compassOffsetDeg = 0;
let absoluteOrientationSensor = null;
let deviceOrientationListener = null;

// =========================================================================
// 1. MANEUVER VECTOR SVG DICTIONARY
// =========================================================================

const MANEUVER_SVGS = {
    straight: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`,
    left: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 19V11a4 4 0 0 0-4-4H5"></path><polyline points="10 2 5 7 10 12"></polyline></svg>`,
    right: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19V11a4 4 0 0 1 4-4h9"></path><polyline points="14 2 19 7 14 12"></polyline></svg>`,
    slight_left: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="17" x2="7" y2="7"></line><polyline points="7 14 7 7 14 7"></polyline></svg>`,
    slight_right: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="10 7 17 7 17 14"></polyline></svg>`,
    uturn: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 18V10a6 6 0 0 0-12 0v8"></path><polyline points="3 14 7 18 11 14"></polyline></svg>`,
    roundabout: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"></circle><polyline points="12 5 15 8 12 11"></polyline></svg>`,
    arrive: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>`
};

function getManeuverIcon(type, modifier) {
    if (type === 'arrive') return { icon: MANEUVER_SVGS.arrive, label: 'Arrive at Destination' };
    if (type === 'depart') return { icon: MANEUVER_SVGS.straight, label: 'Head towards destination' };
    if (type === 'roundabout' || type === 'rotary') return { icon: MANEUVER_SVGS.roundabout, label: 'Take roundabout exit' };

    switch (modifier) {
        case 'sharp left': return { icon: MANEUVER_SVGS.left, label: 'Turn sharp left' };
        case 'left': return { icon: MANEUVER_SVGS.left, label: 'Turn left' };
        case 'slight left': return { icon: MANEUVER_SVGS.slight_left, label: 'Slight left' };
        case 'straight': return { icon: MANEUVER_SVGS.straight, label: 'Continue straight' };
        case 'slight right': return { icon: MANEUVER_SVGS.slight_right, label: 'Slight right' };
        case 'right': return { icon: MANEUVER_SVGS.right, label: 'Turn right' };
        case 'sharp right': return { icon: MANEUVER_SVGS.right, label: 'Turn sharp right' };
        case 'uturn': return { icon: MANEUVER_SVGS.uturn, label: 'Make a U-Turn' };
        default: return { icon: MANEUVER_SVGS.straight, label: 'Head straight' };
    }
}

// =========================================================================
// 2. HOME PAGE INITIAL GPS LOCATION PERMISSION & PICKER SETUP
// =========================================================================

function requestInitialLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            position => {
                const rawLat = position.coords.latitude;
                const rawLon = position.coords.longitude;
                rawGpsAccuracy = position.coords.accuracy || 10;

                const smoothed = filterGPS(rawLat, rawLon, rawGpsAccuracy);
                userLat = smoothed.lat;
                userLon = smoothed.lon;

                if (pickerMap) {
                    pickerMap.setView([userLat, userLon], 18);

                    if (pickerUserMarker) pickerMap.removeLayer(pickerUserMarker);
                    const bluePuckIcon = L.divIcon({
                        className: 'custom-user-picker-marker',
                        html: `<div style="background-color: #1a73e8; width: 18px; height: 18px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 12px rgba(26,115,232,0.9);"></div>`,
                        iconSize: [24, 24], iconAnchor: [12, 12]
                    });
                    pickerUserMarker = L.marker([userLat, userLon], { icon: bluePuckIcon })
                        .addTo(pickerMap)
                        .bindPopup("📍 You are here");
                }

                const instrEl = document.getElementById("picker-instruction");
                if (instrEl && _selectedLat === null) {
                    instrEl.innerText = "📍 Location detected! Tap map or search to set destination";
                }
            },
            error => {
                console.warn("Initial GPS request error:", error.message);
                const instrEl = document.getElementById("picker-instruction");
                if (instrEl) instrEl.innerText = "📍 Enable GPS location or tap map to set destination";
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    }
}

function centerPickerOnUserLocation() {
    if (userLat !== null && userLon !== null) {
        if (pickerMap) {
            pickerMap.setView([userLat, userLon], 18);
            if (pickerUserMarker) pickerUserMarker.openPopup();
        }
    } else {
        document.getElementById("picker-instruction").innerText = "📍 Requesting GPS location...";
        requestInitialLocation();
    }
}

// =========================================================================
// 3. REAL-WORLD ROUTING ENGINE VIA OSRM (WITH MANEUVER STEPS)
// =========================================================================

async function calculateCustomRoute() {
    if (userLat === null || targetLat === null) return;

    updateHUDInstruction("Calculating best route...", "Google Maps OSRM Engine", MANEUVER_SVGS.straight, "0 m");

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${userLon},${userLat};${targetLon},${targetLat}?overview=full&geometries=geojson&steps=true`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            routeCoordinates = route.geometry.coordinates;
            totalRouteDistance = route.distance;
            totalRouteDuration = route.duration;

            if (route.legs && route.legs.length > 0) {
                routeSteps = route.legs[0].steps.map(step => {
                    const iconInfo = getManeuverIcon(step.maneuver.type, step.maneuver.modifier);
                    return {
                        instruction: step.name ? `${iconInfo.label} onto ${step.name}` : iconInfo.label,
                        streetName: step.name || 'Current Road',
                        type: step.maneuver.type,
                        modifier: step.maneuver.modifier,
                        icon: iconInfo.icon,
                        location: step.maneuver.location,
                        distance: step.distance,
                        duration: step.duration
                    };
                });
            } else {
                routeSteps = [];
            }

            currentStepIndex = 0;
            updateRoute3D();
            updateLeafletRoute();
            speakManeuver("Route calculated. Follow Google Live View arrows.");
        } else {
            throw new Error('No route returned');
        }
    } catch (e) {
        console.warn("OSRM routing fallback:", e);
        routeCoordinates = [];
        routeSteps = [{
            instruction: "Head straight to destination",
            streetName: "Direct Bearing",
            type: "straight",
            modifier: "straight",
            icon: MANEUVER_SVGS.straight,
            location: [targetLon, targetLat],
            distance: calculateDistance(userLat, userLon, targetLat, targetLon),
            duration: 0
        }];
        currentStepIndex = 0;
        updateRoute3D();
        updateLeafletRoute();
    }
}

// =========================================================================
// 4. THREE.JS 3D AR SCENE & GROUND PLANE OBJECTS
// =========================================================================

function createGoogleRedPinMesh() {
    const group = new THREE.Group();

    const sphereGeom = new THREE.SphereGeometry(1.5, 32, 32);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xd93025 });
    const sphere = new THREE.Mesh(sphereGeom, pinMat);
    sphere.position.y = 5.0;
    group.add(sphere);

    const dotGeom = new THREE.SphereGeometry(0.55, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const dot = new THREE.Mesh(dotGeom, dotMat);
    dot.position.set(0, 5.0, 1.1);
    group.add(dot);

    const coneGeom = new THREE.ConeGeometry(1.4, 3.2, 32);
    const cone = new THREE.Mesh(coneGeom, pinMat);
    cone.rotation.x = Math.PI;
    cone.position.y = 3.0;
    group.add(cone);

    const cylinderGeom = new THREE.CylinderGeometry(0.5, 0.5, 60, 16, 1, true);
    const cylinderMat = new THREE.MeshBasicMaterial({
        color: 0x1a73e8,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide
    });
    const laser = new THREE.Mesh(cylinderGeom, cylinderMat);
    laser.position.y = 30;
    group.add(laser);

    const ringGeom = new THREE.RingGeometry(1.5, 3.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x1a73e8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    return group;
}

function createRoadArrowMesh() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.8);
    shape.lineTo(-1.4, -0.6);
    shape.lineTo(-0.9, -1.0);
    shape.lineTo(0, 0.6);
    shape.lineTo(0.9, -1.0);
    shape.lineTo(1.4, -0.6);
    shape.lineTo(0, 1.8);

    const geometry = new THREE.ShapeGeometry(shape);
    
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.04;

    const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x1a73e8,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide
    });
    const shadowMesh = new THREE.Mesh(geometry, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.scale.set(1.25, 1.25, 1.25);
    shadowMesh.position.set(0, 0.01, 0);

    const group = new THREE.Group();
    group.add(mesh);
    group.add(shadowMesh);
    group.scale.set(0.7, 0.7, 0.7);
    return group;
}

function init3D() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 1000);
    controls = new THREE.DeviceOrientationControls(camera);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const containerEl = document.getElementById("container");
    containerEl.innerHTML = "";
    containerEl.appendChild(renderer.domElement);

    pathArrows = [];
    for (let i = 0; i < maxArrows; i++) {
        const arrow = createRoadArrowMesh();
        arrow.visible = false;
        pathArrows.push(arrow);
        scene.add(arrow);
    }

    window.addEventListener('resize', onWindowResize);
    animate();
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateRoute3D() {
    if (userLat === null || targetLat === null || !scene) return;

    const points = [];
    let accumulatedDistance = 0;
    
    let prevPoint = new THREE.Vector3(0, GROUND_Y, -1.5);
    points.push(prevPoint);

    if (routeCoordinates.length > 0) {
        for (let coord of routeCoordinates) {
            const cLon = coord[0];
            const cLat = coord[1];
            const dx = (cLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
            const dz = (userLat - cLat) * 111320;

            const nextPoint = new THREE.Vector3(dx, GROUND_Y, dz);
            const segDist = prevPoint.distanceTo(nextPoint);
            accumulatedDistance += segDist;

            if (accumulatedDistance > VISIBLE_PATH_AHEAD) {
                const overshoot = accumulatedDistance - VISIBLE_PATH_AHEAD;
                const exactLengthNeeded = segDist - overshoot;
                const dir = nextPoint.clone().sub(prevPoint).normalize();
                const exactPoint = prevPoint.clone().add(dir.multiplyScalar(exactLengthNeeded));
                exactPoint.y = GROUND_Y;
                points.push(exactPoint);
                break;
            } else {
                points.push(nextPoint);
                prevPoint = nextPoint;
            }
        }
    } else {
        const dx = (targetLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
        const dz = (userLat - targetLat) * 111320;
        let nextPoint = new THREE.Vector3(dx, GROUND_Y, dz);

        const dist = prevPoint.distanceTo(nextPoint);
        if (dist > VISIBLE_PATH_AHEAD) {
            const dir = nextPoint.clone().sub(prevPoint).normalize();
            nextPoint = prevPoint.clone().add(dir.multiplyScalar(VISIBLE_PATH_AHEAD));
            nextPoint.y = GROUND_Y;
        }
        points.push(nextPoint);
    }

    if (points.length >= 2) {
        routeCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.1);
        routeLength = routeCurve.getLength();

        if (pathLineMesh) scene.remove(pathLineMesh);
        const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
        const lineMat = new THREE.LineBasicMaterial({
            color: 0x4285f4,
            linewidth: 6,
            transparent: true,
            opacity: 0.85
        });
        pathLineMesh = new THREE.Line(lineGeom, lineMat);
        pathLineMesh.position.y = 0.01;
        scene.add(pathLineMesh);
    } else {
        routeCurve = null;
        routeLength = 0;
    }

    const finalDx = (targetLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
    const finalDz = (userLat - targetLat) * 111320;

    if (!destinationObject) {
        destinationObject = createGoogleRedPinMesh();
        scene.add(destinationObject);
    }
    destinationObject.position.set(finalDx, GROUND_Y, finalDz);
}

function animate() {
    requestAnimationFrame(animate);

    if (hasStarted && controls) {
        controls.update();
    }

    if (routeCurve && routeLength > 0.1) {
        const speed = 3.2; // m/s
        const time = Date.now() * 0.001;

        for (let i = 0; i < maxArrows; i++) {
            let rawDist = (time * speed + i * arrowSpacing);
            let maxViewWalk = routeLength;
            let distAlong = rawDist % maxViewWalk;
            let t = distAlong / maxViewWalk;

            if (distAlong > 0.5) {
                pathArrows[i].visible = true;
                const pt = routeCurve.getPointAt(t);

                pathArrows[i].position.set(pt.x, GROUND_Y + 0.03, pt.z);

                const tangent = routeCurve.getTangentAt(t).normalize();
                const headingAngle = Math.atan2(tangent.x, -tangent.z);

                pathArrows[i].rotation.set(0, headingAngle, 0);

                let opacity = 0.95;
                if (distAlong < 2) opacity = (distAlong / 2) * 0.95;
                if (maxViewWalk - distAlong < 2) opacity = ((maxViewWalk - distAlong) / 2) * 0.95;

                pathArrows[i].children.forEach(c => {
                    if (c.material) c.material.opacity = Math.max(0, opacity);
                });
            } else {
                pathArrows[i].visible = false;
            }
        }
    } else {
        for (let i = 0; i < maxArrows; i++) {
            pathArrows[i].visible = false;
        }
    }

    updateInstructions();

    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

// =========================================================================
// 5. GOOGLE MAPS NAVIGATION HUD & ETA CALCULATOR
// =========================================================================

function updateHUDInstruction(title, street, iconSvgHtml, badgeDistStr) {
    const titleEl = document.getElementById("instruction");
    const streetEl = document.getElementById("street-name");
    const arrowEl = document.getElementById("nav-arrow");
    const distMainEl = document.getElementById("step-distance-main");

    if (titleEl) titleEl.innerText = title;
    if (streetEl) streetEl.innerText = street;
    if (arrowEl) arrowEl.innerHTML = iconSvgHtml;
    if (distMainEl) distMainEl.innerText = badgeDistStr;
}

function formatClockTime(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
}

function triggerHapticFeedback() {
    if ("vibrate" in navigator) {
        try {
            navigator.vibrate([120, 60, 120]);
        } catch (e) {}
    }
}

function updateInstructions() {
    if (!hasStarted) return;

    if (userLat === null || userLon === null) {
        updateHUDInstruction("Waiting for GPS signal...", "Acquiring location", MANEUVER_SVGS.straight, "0 m");
        return;
    }

    if (targetLat === null || targetLon === null) {
        updateHUDInstruction("Select a destination", "Tap Google Maps or search", MANEUVER_SVGS.straight, "0 m");
        return;
    }

    const totalDist = calculateDistance(userLat, userLon, targetLat, targetLon);
    const distEl = document.getElementById("distance");
    const etaMinEl = document.getElementById("eta-min");
    const etaClockEl = document.getElementById("eta-clock");

    if (distEl) {
        distEl.innerText = totalDist > 1000 ?
            `${(totalDist / 1000).toFixed(1)} km` :
            `${totalDist.toFixed(0)} m`;
    }

    const walkingMin = Math.max(1, Math.ceil((totalDist / 1.35) / 60));
    if (etaMinEl) etaMinEl.innerText = `${walkingMin} min`;

    if (etaClockEl) {
        const arrivalDate = new Date(Date.now() + walkingMin * 60 * 1000);
        etaClockEl.innerText = formatClockTime(arrivalDate);
    }

    if (routeSteps.length > 0 && currentStepIndex < routeSteps.length) {
        const step = routeSteps[currentStepIndex];
        const stepDist = calculateDistance(userLat, userLon, step.location[1], step.location[0]);

        if (stepDist < 15 && currentStepIndex < routeSteps.length - 1) {
            currentStepIndex++;
            const newStep = routeSteps[currentStepIndex];
            triggerHapticFeedback();
            speakManeuver(newStep.instruction);
        }

        const distStr = stepDist > 1000 ? `${(stepDist / 1000).toFixed(1)} km` : `${stepDist.toFixed(0)} m`;
        updateHUDInstruction(step.instruction, step.streetName, step.icon, distStr);

        if (stepDist < 150 && stepDist > 140) {
            speakManeuver(`In 150 meters, ${step.instruction}`);
        } else if (stepDist < 40 && stepDist > 30) {
            triggerHapticFeedback();
            speakManeuver(`In 40 meters, ${step.instruction}`);
        }
    } else {
        let targetBearing = bearing(userLat, userLon, targetLat, targetLon);
        let currentHeading = getEffectiveHeading();

        let diff = ((targetBearing - currentHeading) + 540) % 360 - 180;
        let iconSvg = MANEUVER_SVGS.straight;
        let title = "Head straight";

        if (Math.abs(diff) < 20) {
            title = "Head straight"; iconSvg = MANEUVER_SVGS.straight;
        } else if (diff >= 20 && diff < 160) {
            title = "Turn right"; iconSvg = MANEUVER_SVGS.right;
        } else if (diff <= -20 && diff > -160) {
            title = "Turn left"; iconSvg = MANEUVER_SVGS.left;
        } else {
            title = "Make U-Turn"; iconSvg = MANEUVER_SVGS.uturn;
        }

        const distStr = totalDist > 1000 ? `${(totalDist / 1000).toFixed(1)} km` : `${totalDist.toFixed(0)} m`;
        updateHUDInstruction(title, "Towards destination", iconSvg, distStr);
    }
}

function speakManeuver(text) {
    if (!voiceEnabled || !speechSynth || text === lastSpokenText) return;
    lastSpokenText = text;

    try {
        speechSynth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        speechSynth.speak(utterance);
    } catch (e) {
        console.warn("Speech Synthesis error:", e);
    }
}

function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    const box = document.getElementById("voice-svg-box");
    const label = document.getElementById("voice-label");

    if (voiceEnabled) {
        if (box) box.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
        if (label) label.innerText = "Voice ON";
    } else {
        if (box) box.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M23 9l-6 6m0-6l6 6"></path></svg>`;
        if (label) label.innerText = "Muted";
    }
}

// =========================================================================
// 6. GPS SMOOTHING & ACCURACY RING
// =========================================================================

function filterGPS(rawLat, rawLon, accuracy = 10) {
    if (isNaN(kf.covLat)) {
        kf.lat = rawLat; kf.lon = rawLon;
        kf.covLat = accuracy; kf.covLon = accuracy;
        return { lat: kf.lat, lon: kf.lon };
    }
    let predCovLat = kf.covLat + kf.Q;
    let predCovLon = kf.covLon + kf.Q;

    let KLat = predCovLat / (predCovLat + accuracy);
    let KLon = predCovLon / (predCovLon + accuracy);

    kf.lat = kf.lat + KLat * (rawLat - kf.lat);
    kf.lon = kf.lon + KLon * (rawLon - kf.lon);

    kf.covLat = (1 - KLat) * predCovLat;
    kf.covLon = (1 - KLon) * predCovLon;

    return { lat: kf.lat, lon: kf.lon };
}

function updateSpeedometer(speedMps) {
    const speedEl = document.getElementById("speed-val");
    if (!speedEl) return;

    let kmh = 0;
    if (speedMps && speedMps > 0) {
        kmh = (speedMps * 3.6).toFixed(0);
    } else if (simulationActive) {
        kmh = 4.8; // Average walking speed in demo simulation
    }
    speedEl.innerText = kmh;
}

function getLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            position => {
                if (simulationActive) return;

                const rawLat = position.coords.latitude;
                const rawLon = position.coords.longitude;
                rawGpsAccuracy = position.coords.accuracy || 10;

                const speed = position.coords.speed || 0;
                updateSpeedometer(speed);

                const smoothed = filterGPS(rawLat, rawLon, rawGpsAccuracy);
                userLat = smoothed.lat;
                userLon = smoothed.lon;

                updateGPSBadge(rawGpsAccuracy);

                const initFetching = (routeCoordinates.length === 0 && targetLat !== null);

                if (initFetching) {
                    calculateCustomRoute();
                } else {
                    updateRoute3D();
                }

                updateLeafletUserMarker();
            },
            error => {
                console.warn("GPS Location error:", error.message);
                updateHUDInstruction("GPS Signal Weak", "Ensure location permissions", MANEUVER_SVGS.straight, "0 m");
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    }
}

function updateGPSBadge(acc) {
    const gpsEl = document.getElementById("gps-badge");
    if (!gpsEl) return;
    gpsEl.innerText = `GPS Acc: ${acc.toFixed(0)}m`;
}

// =========================================================================
// 7. COMPASS & MAP ORIENTATION (HEADING-UP vs NORTH-UP)
// =========================================================================

function getEffectiveHeading() {
    if (compassHeading === null) return 0;
    return (compassHeading + compassOffsetDeg + 360) % 360;
}

function startCompass() {
    window.addEventListener('deviceorientationabsolute', function (event) {
        if (event.alpha !== null) {
            const heading = 360 - event.alpha;
            compassHeading = smoothHeading(compassHeading, heading);
            updateCompassDisplay();
        }
    }, true);

    deviceOrientationListener = function (event) {
        let heading = null;
        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
            heading = event.webkitCompassHeading;
        } else if (event.alpha !== null && compassHeading === null) {
            heading = 360 - event.alpha;
        }
        if (heading !== null) {
            compassHeading = smoothHeading(compassHeading, heading);
            updateCompassDisplay();
        }
    };
    window.addEventListener('deviceorientation', deviceOrientationListener, true);

    if (typeof AbsoluteOrientationSensor !== 'undefined') {
        try {
            absoluteOrientationSensor = new AbsoluteOrientationSensor({ frequency: 60 });
            absoluteOrientationSensor.addEventListener('reading', () => {
                const q = absoluteOrientationSensor.quaternion;
                const heading = Math.atan2(
                    2 * (q[0] * q[3] + q[1] * q[2]),
                    1 - 2 * (q[2] * q[2] + q[3] * q[3])
                ) * (180 / Math.PI);
                const absoluteDeg = (heading + 360) % 360;
                compassHeading = smoothHeading(compassHeading, absoluteDeg);
                updateCompassDisplay();
            });
            absoluteOrientationSensor.start();
        } catch (e) {
            console.warn("AbsoluteOrientationSensor fallback:", e);
        }
    }
}

function smoothHeading(oldH, newH) {
    if (oldH === null) return newH;
    let diff = ((newH - oldH) + 540) % 360 - 180;
    return (oldH + 0.25 * diff + 360) % 360;
}

function updateCompassDisplay() {
    const el = document.getElementById("compass-info");
    if (el) {
        const effHeading = getEffectiveHeading();
        el.innerText = `${effHeading.toFixed(0)}°`;
    }
    updateLeafletUserMarker();
}

function toggleMapOrientation() {
    isHeadingUp = !isHeadingUp;
    const label = document.getElementById("orient-label");
    if (label) {
        label.innerText = isHeadingUp ? "Heading Up" : "North Up";
    }
    updateLeafletUserMarker();
}

function toggleCompassModal() {
    const modal = document.getElementById("compass-modal");
    if (modal) {
        modal.style.display = modal.style.display === "none" ? "block" : "none";
    }
}

function nudgeCompass(delta) {
    compassOffsetDeg += delta;
    const label = document.getElementById("compass-offset-label");
    if (label) label.innerText = `Offset: ${compassOffsetDeg > 0 ? '+' : ''}${compassOffsetDeg}°`;
    updateCompassDisplay();
    updateRoute3D();
}

function resetCompassOffset() {
    compassOffsetDeg = 0;
    const label = document.getElementById("compass-offset-label");
    if (label) label.innerText = `Offset: 0°`;
    updateCompassDisplay();
    updateRoute3D();
}

function stopCompass() {
    if (deviceOrientationListener) {
        window.removeEventListener('deviceorientation', deviceOrientationListener, true);
    }
    if (absoluteOrientationSensor) {
        absoluteOrientationSensor.stop();
    }
    compassHeading = null;
}

// =========================================================================
// 8. GOOGLE MAPS LEAFLET INTEGRATION & 2KM TILE BUFFER ENGINE
// =========================================================================

function initMap() {
    if (leafletMap) return;

    leafletMap = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([userLat || 10.641123, userLon || 77.029058], 18);

    setMapTileStyle('street');
}

function setMapTileStyle(style) {
    if (!leafletMap) return;
    if (currentTileLayer) leafletMap.removeLayer(currentTileLayer);

    mapTileStyle = style;
    let tileUrl = 'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
    let sub = ['mt0', 'mt1', 'mt2', 'mt3'];

    if (style === 'satellite') {
        tileUrl = 'https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}';
    } else if (style === 'dark') {
        tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        sub = ['a', 'b', 'c', 'd'];
    }

    currentTileLayer = L.tileLayer(tileUrl, {
        maxZoom: 20,
        subdomains: sub,
        keepBuffer: 30,
        updateWhenIdle: false,
        updateWhenZooming: false
    }).addTo(leafletMap);
}

function toggleMapStyle() {
    const label = document.getElementById("map-style-label");
    if (mapTileStyle === 'street') {
        setMapTileStyle('satellite');
        if (label) label.innerText = "Satellite";
    } else if (mapTileStyle === 'satellite') {
        setMapTileStyle('dark');
        if (label) label.innerText = "Dark";
    } else {
        setMapTileStyle('street');
        if (label) label.innerText = "Street";
    }
}

function updateLeafletUserMarker() {
    if (!leafletMap || userLat === null || userLon === null) return;

    const heading = getEffectiveHeading();

    const mapEl = document.getElementById("map");
    if (mapEl) {
        mapEl.style.transform = isHeadingUp ? `rotate(${-heading}deg)` : `rotate(0deg)`;
    }

    if (!userMarker) {
        const userIcon = L.divIcon({
            className: 'custom-user-marker',
            html: `<div style="background-color: #1a73e8; width: 18px; height: 18px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 10px rgba(26,115,232,0.9);"></div>`,
            iconSize: [24, 24], iconAnchor: [12, 12]
        });
        userMarker = L.marker([userLat, userLon], { icon: userIcon }).addTo(leafletMap);

        const fovIcon = L.divIcon({
            className: 'leaflet-user-fov-cone',
            html: `<div style="width: 0; height: 0; border-left: 25px solid transparent; border-right: 25px solid transparent; border-bottom: 50px solid rgba(26,115,232,0.4); transform: rotate(${isHeadingUp ? 0 : heading}deg); transform-origin: 50% 100%;"></div>`,
            iconSize: [50, 50], iconAnchor: [25, 50]
        });
        userFovCone = L.marker([userLat, userLon], { icon: fovIcon, zIndexOffset: -100 }).addTo(leafletMap);

        accuracyCircleMarker = L.circle([userLat, userLon], {
            radius: rawGpsAccuracy,
            color: '#1a73e8',
            fillColor: '#1a73e8',
            fillOpacity: 0.15,
            weight: 1
        }).addTo(leafletMap);
    } else {
        userMarker.setLatLng([userLat, userLon]);
        if (userFovCone) {
            userFovCone.setLatLng([userLat, userLon]);
            const coneEl = userFovCone.getElement();
            if (coneEl) {
                const child = coneEl.querySelector('div');
                if (child) child.style.transform = `rotate(${isHeadingUp ? 0 : heading}deg)`;
            }
        }
        if (accuracyCircleMarker) {
            accuracyCircleMarker.setLatLng([userLat, userLon]);
            accuracyCircleMarker.setRadius(rawGpsAccuracy);
        }
    }

    if (!isMapExpanded) {
        leafletMap.setView([userLat, userLon], 18);
    }
}

function updateLeafletRoute() {
    if (!leafletMap) return;

    if (targetLat !== null && targetLon !== null) {
        if (!targetMarker) {
            const pinIcon = L.divIcon({
                className: 'custom-target-pin',
                html: `<div style="background-color: #d93025; width: 22px; height: 22px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.4);"><div style="width: 8px; height: 8px; background: #fff; border-radius: 50%; margin: 5px auto;"></div></div>`,
                iconSize: [24, 24], iconAnchor: [12, 24]
            });
            targetMarker = L.marker([targetLat, targetLon], { icon: pinIcon }).addTo(leafletMap);
        } else {
            targetMarker.setLatLng([targetLat, targetLon]);
        }
    }

    if (mapRouteLine) leafletMap.removeLayer(mapRouteLine);
    maneuverMapMarkers.forEach(m => leafletMap.removeLayer(m));
    maneuverMapMarkers = [];

    if (routeCoordinates.length > 0) {
        let latlngs = routeCoordinates.map(coord => [coord[1], coord[0]]);
        if (userLat !== null && userLon !== null) latlngs.unshift([userLat, userLon]);

        const outerLine = L.polyline(latlngs, { color: '#185abc', weight: 9, opacity: 0.9 });
        const innerLine = L.polyline(latlngs, { color: '#4285f4', weight: 5, opacity: 1.0 });
        mapRouteLine = L.layerGroup([outerLine, innerLine]).addTo(leafletMap);

        if (routeSteps.length > 0) {
            routeSteps.forEach(step => {
                const stepIcon = L.divIcon({
                    className: 'map-step-node',
                    html: `<div style="background: #ffffff; color: #1a73e8; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #1a73e8; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${step.icon}</div>`,
                    iconSize: [20, 20], iconAnchor: [10, 10]
                });
                const mMarker = L.marker([step.location[1], step.location[0]], { icon: stepIcon }).addTo(leafletMap);
                maneuverMapMarkers.push(mMarker);
            });
        }

        if (userLat !== null && userLon !== null) {
            const bounds = L.latLngBounds([userLat, userLon], [targetLat, targetLon]);
            leafletMap.fitBounds(bounds, { padding: [35, 35] });
        }
    }
}

function toggleMap() {
    isMapExpanded = !isMapExpanded;
    const container = document.getElementById("minimap-container");
    const iconBox = document.getElementById("toggle-map-icon");
    const label = document.getElementById("toggle-map-label");

    if (isMapExpanded) {
        container.classList.add("expanded");
        if (label) label.innerText = "Collapse Map";
        if (iconBox) iconBox.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="10" y1="14" x2="3" y2="21"></line></svg>`;
    } else {
        container.classList.remove("expanded");
        if (label) label.innerText = "Expand Map";
        if (iconBox) iconBox.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
    }

    setTimeout(() => {
        if (leafletMap) {
            leafletMap.invalidateSize();
            if (userLat !== null && userLon !== null) leafletMap.setView([userLat, userLon], 18);
        }
    }, 100);
    setTimeout(() => {
        if (leafletMap) {
            leafletMap.invalidateSize();
        }
    }, 380);
}

function recenterMap() {
    if (leafletMap && userLat !== null && userLon !== null) {
        leafletMap.setView([userLat, userLon], 18);
    }
}

// =========================================================================
// 9. TEST DEMO WALK SIMULATION ENGINE
// =========================================================================

function toggleSimulation() {
    simulationActive = !simulationActive;
    const box = document.getElementById("sim-svg-box");
    const label = document.getElementById("sim-label");

    if (simulationActive) {
        if (routeCoordinates.length < 2) {
            alert("Please select a destination to calculate route before starting simulation!");
            simulationActive = false;
            return;
        }
        if (box) box.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
        if (label) label.innerText = "Stop Walk";

        simStepIndex = 0;
        updateSpeedometer(1.35); // 4.8 km/h walking speed
        speakManeuver("Starting Google Maps demo walk.");

        simulationTimer = setInterval(() => {
            if (simStepIndex < routeCoordinates.length) {
                const coord = routeCoordinates[simStepIndex];
                userLon = coord[0];
                userLat = coord[1];

                if (simStepIndex < routeCoordinates.length - 1) {
                    const nextCoord = routeCoordinates[simStepIndex + 1];
                    compassHeading = bearing(userLat, userLon, nextCoord[1], nextCoord[0]);
                }

                updateRoute3D();
                updateLeafletUserMarker();
                updateCompassDisplay();
                simStepIndex++;
            } else {
                toggleSimulation();
                speakManeuver("You have arrived at your destination.");
            }
        }, 1100);
    } else {
        if (box) box.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
        if (label) label.innerText = "Demo Walk";

        updateSpeedometer(0);
        if (simulationTimer) clearInterval(simulationTimer);
        simulationTimer = null;
    }
}

// =========================================================================
// 10. GOOGLE MAPS DESTINATION PICKER & NOMINATIM SEARCH
// =========================================================================

function initDestinationPicker() {
    if (pickerMap) return;

    pickerMap = L.map('picker-map', {
        zoomControl: true,
        attributionControl: true
    }).setView([10.678645, 77.032418], 17);

    L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        keepBuffer: 30,
        updateWhenIdle: false,
        updateWhenZooming: false
    }).addTo(pickerMap);

    pickerMap.on('click', function (e) {
        setPickedDestination(e.latlng.lat, e.latlng.lng, null);
    });

    requestInitialLocation();
}

function setPickedDestination(lat, lng, label) {
    _selectedLat = lat;
    _selectedLon = lng;

    if (pickerMarker) pickerMap.removeLayer(pickerMarker);
    const pinIcon = L.divIcon({
        className: 'custom-target-pin',
        html: `<div style="background-color: #d93025; width: 24px; height: 24px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.4);"><div style="width: 8px; height: 8px; background: #fff; border-radius: 50%; margin: 6px auto;"></div></div>`,
        iconSize: [26, 26], iconAnchor: [13, 26]
    });
    pickerMarker = L.marker([lat, lng], { icon: pinIcon }).addTo(pickerMap);

    document.getElementById('selected-coords').innerText = `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    document.getElementById('picker-instruction').innerText = label || '📍 Destination set! Tap Start Navigation to begin';
    document.getElementById('start-nav-btn').style.display = 'flex';
}

let searchTimeout = null;
function handleSearch() {
    clearTimeout(searchTimeout);
    const query = document.getElementById("search-input").value.trim();
    const resultsEl = document.getElementById("search-results");

    if (query.length < 3) {
        resultsEl.style.display = "none";
        return;
    }

    searchTimeout = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`)
            .then(r => r.json())
            .then(data => {
                resultsEl.innerHTML = "";
                if (!data || data.length === 0) {
                    resultsEl.style.display = "none";
                    return;
                }
                resultsEl.style.display = "block";
                data.forEach(r => {
                    const div = document.createElement("div");
                    div.className = "search-result-item";
                    div.innerText = r.display_name;
                    div.onclick = () => {
                        pickerMap.setView([parseFloat(r.lat), parseFloat(r.lon)], 18);
                        setPickedDestination(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
                        resultsEl.style.display = "none";
                        document.getElementById("search-input").value = "";
                    };
                    resultsEl.appendChild(div);
                });
            })
            .catch(() => {});
    }, 400);
}

function clearSearch() {
    document.getElementById("search-input").value = "";
    document.getElementById("search-results").style.display = "none";
}

function quickSearch(placeName) {
    document.getElementById("search-input").value = placeName;
    handleSearch();
}

// =========================================================================
// 11. SYSTEM ENTRY & EXIT WORKFLOWS
// =========================================================================

function startAR() {
    if (_selectedLat === null || _selectedLon === null) return;

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                proceedWithAR(response === 'granted');
            })
            .catch(() => { proceedWithAR(false); });
    } else {
        proceedWithAR(true);
    }
}

function proceedWithAR(orientationGranted) {
    document.getElementById("destination-picker").style.display = "none";
    document.getElementById("ui-overlay").style.display = "flex";
    hasStarted = true;

    targetLat = _selectedLat;
    targetLon = _selectedLon;

    startCamera();
    getLocation();

    init3D();
    initMap();

    if (orientationGranted) {
        startCompass();
    }
}

function stopAR() {
    hasStarted = false;
    if (simulationActive) toggleSimulation();

    document.getElementById("destination-picker").style.display = "flex";
    document.getElementById("ui-overlay").style.display = "none";

    const video = document.getElementById('camera-feed');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    if (renderer) {
        document.getElementById("container").innerHTML = "";
    }
    stopCompass();

    scene = null; camera = null; renderer = null; controls = null;
    pathLineMesh = null; destinationObject = null;
    pathArrows = []; routeCoordinates = []; routeSteps = [];

    if (leafletMap) {
        leafletMap.remove();
        leafletMap = null; userMarker = null; userFovCone = null;
        targetMarker = null; mapRouteLine = null; isMapExpanded = false;
        accuracyCircleMarker = null; maneuverMapMarkers = [];
        document.getElementById("minimap-container").classList.remove("expanded");
        document.getElementById("toggle-map-btn").innerText = "⛕ Expand Map";
    }

    setTimeout(() => { if (pickerMap) pickerMap.invalidateSize(); }, 100);
}

function startCamera() {
    const video = document.getElementById('camera-feed');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        updateHUDInstruction("Camera Not Supported", "Navigation running without AR video", MANEUVER_SVGS.straight, "0 m");
        return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(stream => { video.srcObject = stream; })
        .catch(err => {
            console.warn("Camera access denied:", err);
            updateHUDInstruction("Camera Permission Denied", "Navigation running on fallback", MANEUVER_SVGS.straight, "0 m");
        });
}

// Math helpers
function toRadians(deg) { return deg * (Math.PI / 180); }
function toDegrees(rad) { return rad * (180 / Math.PI); }

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function bearing(lat1, lon1, lat2, lon2) {
    const dLon = toRadians(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
    const x = Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
              Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// Initialize destination picker and request GPS location on load
document.addEventListener('DOMContentLoaded', function () {
    initDestinationPicker();

    if (!window.isSecureContext) {
        const warningBanner = document.getElementById("secure-context-warning");
        if (warningBanner) warningBanner.style.display = "block";
    }
});
