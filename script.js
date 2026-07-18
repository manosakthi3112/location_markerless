let scene, camera, renderer, controls;
let userLat = null, userLon = null;
let targetLat = null, targetLon = null;
let destinationObject = null;
let pathLine = null;
let pathArrows = [];
let maxArrows = 15;
let arrowSpacing = 2.0; // meters (denser)
let hasStarted = false;

// Kalman Filter State for GPS Smoothing
let kf = {
    R: 10,   // noise power (gps inaccuracy meters roughly)
    Q: 0.1,  // Process noise (how fast we expect user to move)
    A: 1,    // State vector
    B: 0,    // Control vector
    C: 1,    // Measurement vector
    lat: null,
    lon: null,
    covLat: NaN,
    covLon: NaN
};

// Leaflet Map Globals
let leafletMap = null;
let userMarker = null;
let targetMarker = null;
let mapRouteLine = null;
let isMapExpanded = false;

// Routing API Globals
let routeCoordinates = []; // GeoJSON [lon, lat] array from OSRM
let routeCurve = null;     // THREE.CatmullRomCurve3
let routeLength = 0;       // Length of the spline curve

// Constants for Progressive Rendering
const VISIBLE_PATH_AHEAD = 30; // Show exactly 30 meters of track line ahead so turns are visible

// 1 degree of latitude is ~111km. So 111,000 meters
const M_PER_DEG_LAT = 111320;
let initialLat = null, initialLon = null;

// Compass / Gyroscope state
let compassHeading = null;
let compassAccuracy = null;
let absoluteOrientationSensor = null;
let deviceOrientationListener = null;

function createRoadArrow() {
    // CCW Street View Chevron Shape (properly triangulated)
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.5);
    shape.lineTo(-1.5, -0.5);
    shape.lineTo(-1.0, -0.9);
    shape.lineTo(0, 0.5);
    shape.lineTo(1.0, -0.9);
    shape.lineTo(1.5, -0.5);
    shape.lineTo(0, 1.5);

    const geometry = new THREE.ShapeGeometry(shape);
    // Bold white color like Google Street View
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // Flat and facing -Z direction
    mesh.position.y = 0.05; // elevate slightly above shadow

    // Deeper Drop shadow chevron
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const shadowMesh = new THREE.Mesh(geometry, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.scale.set(1.15, 1.15, 1.15);
    shadowMesh.position.set(0, 0.01, -0.2);

    const group = new THREE.Group();
    group.add(mesh);
    group.add(shadowMesh);

    // Scale moderately so perspective works better over distance
    group.scale.set(0.5, 0.5, 0.5); // Slightly smaller for better screen fit

    return group;
}

function init3D() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // Add DeviceOrientationControls
    controls = new THREE.DeviceOrientationControls(camera);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    document.getElementById("container").appendChild(renderer.domElement);

    // Initial grid for feeling the floor (Optional debug)
    // const gridHelper = new THREE.GridHelper( 50, 50, 0x444444, 0x888888 );
    // gridHelper.position.y = -2;
    // scene.add( gridHelper );

    for (let i = 0; i < maxArrows; i++) {
        const arrow = createRoadArrow();
        arrow.visible = false;
        pathArrows.push(arrow);
        scene.add(arrow);
    }

    animate();
}

/* ================= REAL-WORLD ROUTING VIA OSRM (OpenStreetMap) ================= */
// Uses OSRM's free routing API to get road-following paths

async function calculateCustomRoute() {
    if (userLat === null || targetLat === null) return;

    document.getElementById("instruction").innerText = "Fetching route from OSRM...";

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${userLon},${userLat};${targetLon},${targetLat}?geometries=geojson&overview=full`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            routeCoordinates = data.routes[0].geometry.coordinates;
            updateRoute3D();
            updateLeafletRoute();
        } else {
            throw new Error('No route returned');
        }
    } catch (e) {
        console.error("OSRM routing failed, using straight line fallback:", e);
        document.getElementById("instruction").innerText = "Routing unavailable, using direct line";
        routeCoordinates = [];
        updateRoute3D();
        updateLeafletRoute();
    }
}

function updateLeafletRoute() {
    if (!leafletMap) return;

    // Draw target marker
    if (targetLat !== null && targetLon !== null) {
        if (!targetMarker) {
            targetMarker = L.marker([targetLat, targetLon]).addTo(leafletMap);
        } else {
            targetMarker.setLatLng([targetLat, targetLon]);
        }
    }

    // Draw route line
    if (mapRouteLine) {
        leafletMap.removeLayer(mapRouteLine);
        mapRouteLine = null;
    }

    if (routeCoordinates.length > 0) {
        // routeCoordinates is an array of [lon, lat], Leaflet needs [lat, lon]
        let latlngs = routeCoordinates.map(coord => [coord[1], coord[0]]);

        // Ensure path starts from current user location (e.g. going out of room)
        if (userLat !== null && userLon !== null) {
            latlngs.unshift([userLat, userLon]);
        }

        // Google Maps style path (thick blue border, lighter blue inside)
        const outerLine = L.polyline(latlngs, { color: '#1a73e8', weight: 8, opacity: 0.9 });
        const innerLine = L.polyline(latlngs, { color: '#4285f4', weight: 4, opacity: 1.0 });

        mapRouteLine = L.layerGroup([outerLine, innerLine]).addTo(leafletMap);

        // Fit bounds to show route
        if (userLat !== null && userLon !== null) {
            const bounds = L.latLngBounds([userLat, userLon], [targetLat, targetLon]);
            leafletMap.fitBounds(bounds, { padding: [20, 20] });
        }
    }
}

function updateRoute3D() {
    if (userLat === null || targetLat === null) return;

    const points = [];

    // We only want to draw the line up to a max of 10 meters away from the user's current camera position
    // First, find the exact path points and calculate distance accumulating along the way.

    let accumulatedDistance = 0;
    let prevPoint = new THREE.Vector3(0, -2.5, 0); // User is at 0,0,0
    points.push(prevPoint);

    if (routeCoordinates.length > 0) {
        for (let coord of routeCoordinates) {
            const cLon = coord[0];
            const cLat = coord[1];
            const dx = (cLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
            const dz = (userLat - cLat) * 111320;

            const nextPoint = new THREE.Vector3(dx, -2.5, dz);

            // Calculate distance to this next segment
            const segDist = prevPoint.distanceTo(nextPoint);
            accumulatedDistance += segDist;

            // Stop building the track line if we've passed 10 meters
            if (accumulatedDistance > VISIBLE_PATH_AHEAD) {
                // If we overshoot, cut the line back to exactly 10 meters
                const overshoot = accumulatedDistance - VISIBLE_PATH_AHEAD;
                const exactLengthNeeded = segDist - overshoot;
                const dir = nextPoint.clone().sub(prevPoint).normalize();
                const exactPoint = prevPoint.clone().add(dir.multiplyScalar(exactLengthNeeded));
                points.push(exactPoint);
                break;
            } else {
                points.push(nextPoint);
                prevPoint = nextPoint;
            }
        }
    } else {
        // Fallback: Straight line
        const dx = (targetLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
        const dz = (userLat - targetLat) * 111320;
        let nextPoint = new THREE.Vector3(dx, -2.5, dz);

        const dist = prevPoint.distanceTo(nextPoint);
        if (dist > VISIBLE_PATH_AHEAD) {
            // Cut it at exactly 10m
            const dir = nextPoint.clone().sub(prevPoint).normalize();
            nextPoint = prevPoint.clone().add(dir.multiplyScalar(VISIBLE_PATH_AHEAD));
        }
        points.push(nextPoint);
    }

    // Update Path Line Geometry
    if (!pathLine) {
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff00,
            linewidth: 8, // thicker line visually
        });
        const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
        pathLine = new THREE.Line(lineGeom, lineMaterial);
        scene.add(pathLine);
    } else {
        pathLine.geometry.setFromPoints(points);
        pathLine.computeLineDistances();
    }

    // Create Spline Curve for arrows to follow (we build curve from ONLY the limited points)
    if (points.length >= 2) {
        routeCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.1);
        routeLength = routeCurve.getLength();
    } else {
        routeCurve = null;
        routeLength = 0;
    }

    // Keep destination Object at the absolute final coordinates, NOT the 10m marker
    const finalDx = (targetLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
    const finalDz = (userLat - targetLat) * 111320;

    if (!destinationObject) {
        const geom = new THREE.CylinderGeometry(0, 1, 4, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
        destinationObject = new THREE.Mesh(geom, mat);
        scene.add(destinationObject);

        const ringGeom = new THREE.RingGeometry(1, 1.5, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -2;
        destinationObject.add(ring);
    }
    destinationObject.position.set(finalDx, 0, finalDz);
}

function animate() {
    requestAnimationFrame(animate);

    if (hasStarted && controls) {
        controls.update();
    }

    // No need to animate dash offset anymore since line is solid

    // Animate Arrows along the Spline Curve (which is strictly max 10m long now)
    if (routeCurve && routeLength > 0.1) {
        const speed = 2.0; // units per second
        const time = Date.now() * 0.001;

        for (let i = 0; i < maxArrows; i++) {
            let rawDist = (time * speed + i * arrowSpacing);
            // Cycle arrows ONLY within the visible track length
            let maxViewWalk = routeLength;
            let distAlong = rawDist % maxViewWalk;

            let t = distAlong / maxViewWalk;
            if (t > 1) t = 1;

            if (distAlong > 0.5) { // offset from feet
                pathArrows[i].visible = true;

                const pt = routeCurve.getPointAt(t);
                pathArrows[i].position.set(pt.x, -2.5, pt.z);

                const tangent = routeCurve.getTangentAt(t).normalize();

                // Smooth arrow rotation using lookAt rather than sharp atan2 assignment
                const targetPos = pt.clone().add(tangent);
                pathArrows[i].lookAt(targetPos);

                let opacity = 0.9;
                if (distAlong < 2) opacity = (distAlong / 2) * 0.9;
                if (maxViewWalk - distAlong < 2) opacity = ((maxViewWalk - distAlong) / 2) * 0.9; // fade early

                pathArrows[i].children.forEach(c => {
                    if (c.material) c.material.opacity = Math.max(0, opacity);
                });
            } else {
                pathArrows[i].visible = false;
            }
        }
    } else {
        // Hide arrows if no route
        for (let i = 0; i < maxArrows; i++) {
            pathArrows[i].visible = false;
        }
    }

    updateInstructions();

    renderer.render(scene, camera);
}

function updateInstructions() {
    if (!hasStarted) return;

    const instructionEl = document.getElementById("instruction");

    if (userLat === null || userLon === null) {
        instructionEl.innerText = "Waiting for GPS Signal...";
        return;
    }

    if (targetLat === null || targetLon === null) {
        instructionEl.innerText = "Please Select a Target Location";
        return;
    }

    if (!destinationObject) {
        instructionEl.innerText = "Calculating Route...";
        return;
    }

    // Calculate distance
    const distance = calculateDistance(userLat, userLon, targetLat, targetLon);
    const distanceEl = document.getElementById("distance");
    if (distanceEl) {
        if (distance > 1000) {
            distanceEl.innerText = "Distance: " + (distance / 1000).toFixed(2) + " km";
        } else {
            distanceEl.innerText = "Distance: " + distance.toFixed(0) + " meters";
        }
    }

    // Update compass display
    const compassEl = document.getElementById("compass-info");
    if (compassEl) {
        if (compassHeading !== null) {
            compassEl.innerText = `🧭 ${compassHeading.toFixed(0)}°`;
        } else {
            compassEl.innerText = "🧭 ---";
        }
    }

    const navIcon = document.getElementById("nav-arrow");
    let instruction = "Orienting...";
    let arrowIcon = "🔄";

    // ===== PRIMARY: Gyroscope + compass heading (more accurate) =====
    if (compassHeading !== null) {
        let targetBearing;
        if (routeCurve && routeLength > 0.5) {
            // Use tangent of the route curve right ahead for road direction
            const lookAhead = Math.min(3 / routeLength, 0.5);
            const tangent = routeCurve.getTangentAt(lookAhead).normalize();
            // tangent.x = east, tangent.z = south (in scene coords)
            targetBearing = (toDegrees(Math.atan2(tangent.x, -tangent.z)) + 360) % 360;
        } else {
            // Straight bearing to destination
            targetBearing = bearing(userLat, userLon, targetLat, targetLon);
        }

        let diff = ((targetBearing - compassHeading) + 540) % 360 - 180;

        if (Math.abs(diff) < 15) {
            instruction = "Head Straight";
            arrowIcon = "↑";
        } else if (diff > 15 && diff < 165) {
            instruction = "Turn Right";
            arrowIcon = "→";
        } else if (diff < -15 && diff > -165) {
            instruction = "Turn Left";
            arrowIcon = "←";
        } else if (Math.abs(diff) >= 165) {
            instruction = "Turn Around";
            arrowIcon = "↓";
        }
    } else {
        // ===== FALLBACK: Three.js camera direction (no compass available) =====
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0;
        cameraDirection.normalize();

        let targetDirection = new THREE.Vector3();

        if (routeCurve && routeLength > 5) {
            let lookAheadDistance = 5;
            let t = lookAheadDistance / routeLength;
            if (t > 1) t = 1;

            const pathPoint = routeCurve.getPointAt(t);
            targetDirection.set(pathPoint.x, 0, pathPoint.z).normalize();
        } else if (destinationObject) {
            targetDirection.set(destinationObject.position.x, 0, destinationObject.position.z).normalize();
        }

        const cross = new THREE.Vector3().crossVectors(cameraDirection, targetDirection);
        const dot = cameraDirection.dot(targetDirection);
        const angle = Math.atan2(cross.y, dot) * (180 / Math.PI);

        if (dot > 0.9) {
            instruction = "Head Straight";
            arrowIcon = "↑";
        } else if (angle > 15) {
            instruction = "Turn Left";
            arrowIcon = "←";
        } else if (angle < -15) {
            instruction = "Turn Right";
            arrowIcon = "→";
        } else if (dot < 0) {
            instruction = "Turn Around";
            arrowIcon = "↓";
        }
    }

    document.getElementById("instruction").innerText = instruction;
    if (navIcon) navIcon.innerText = arrowIcon;
}


// Simple 1D Kalman implementation applied to lat/lon separately
function filterGPS(rawLat, rawLon, accuracy = 10) {
    if (isNaN(kf.covLat)) {
        kf.lat = rawLat;
        kf.lon = rawLon;
        kf.covLat = accuracy;
        kf.covLon = accuracy;
        return { lat: kf.lat, lon: kf.lon };
    }

    // Predict
    let predLat = kf.lat;
    let predLon = kf.lon;
    let predCovLat = kf.covLat + kf.Q;
    let predCovLon = kf.covLon + kf.Q;

    // Update (Measurement R is tied to reported accuracy)
    let KLat = predCovLat / (predCovLat + accuracy);
    let KLon = predCovLon / (predCovLon + accuracy);

    kf.lat = predLat + KLat * (rawLat - predLat);
    kf.lon = predLon + KLon * (rawLon - predLon);

    kf.covLat = (1 - KLat) * predCovLat;
    kf.covLon = (1 - KLon) * predCovLon;

    return { lat: kf.lat, lon: kf.lon };
}

// Distance to polyline feature for auto-recalculation
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    let A = px - x1;
    let B = py - y1;
    let C = x2 - x1;
    let D = y2 - y1;

    let dot = A * C + B * D;
    let len_sq = C * C + D * D;
    let param = -1;
    if (len_sq != 0) //in case of 0 length line
        param = dot / len_sq;

    let xx, yy;
    if (param < 0) {
        xx = x1; yy = y1;
    } else if (param > 1) {
        xx = x2; yy = y2;
    } else {
        xx = x1 + param * C; yy = y1 + param * D;
    }

    // Haversine dist back from raw degrees interpolation (approximation for small distances)
    return calculateDistance(py, px, yy, xx);
}

function isOffPath(currentLat, currentLon) {
    if (routeCoordinates.length < 2) return false;

    let minDist = Infinity;
    for (let i = 0; i < routeCoordinates.length - 1; i++) {
        const p1 = routeCoordinates[i];
        const p2 = routeCoordinates[i + 1];
        // p is [lon, lat]
        const d = pointToSegmentDistance(currentLon, currentLat, p1[0], p1[1], p2[0], p2[1]);
        if (d < minDist) minDist = d;
    }

    // If further than 15 meters from the exact route line, recalculate
    return minDist > 15;
}

function getLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            position => {
                const rawLat = position.coords.latitude;
                const rawLon = position.coords.longitude;
                const acc = position.coords.accuracy || 10;

                // 1. Kalman Smoothing Filter
                const smoothed = filterGPS(rawLat, rawLon, acc);
                userLat = smoothed.lat;
                userLon = smoothed.lon;

                const initFetching = (routeCoordinates.length === 0 && targetLat !== null);

                const coordsEl = document.getElementById("current-coords");
                if (coordsEl) {
                    coordsEl.innerText = `GPS Acc: ${acc.toFixed(1)}m`;
                }

                // 2. Off-Path Auto Recalculation Check
                let findingNewPath = false;
                if (!initFetching && routeCoordinates.length > 0) {
                    if (isOffPath(userLat, userLon)) {
                        console.log("User off path! Recalculating...");
                        document.getElementById("instruction").innerText = "Recalculating Route...";
                        findingNewPath = true;
                        calculateCustomRoute();
                    }
                }

                // 3. Regular Update Workflow
                if (initFetching) {
                    calculateCustomRoute();
                } else if (!findingNewPath) {
                    updateRoute3D();
                }

                // Update Leaflet Map
                if (leafletMap) {
                    if (!userMarker) {
                        // Custom blue dot for user
                        const userIcon = L.divIcon({
                            className: 'custom-user-marker',
                            html: '<div style="background-color: #1e88e5; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>',
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        userMarker = L.marker([userLat, userLon], { icon: userIcon }).addTo(leafletMap);
                        leafletMap.setView([userLat, userLon], 18); // Zoom in on first lock
                    } else {
                        userMarker.setLatLng([userLat, userLon]);
                    }
                }
            },
            error => {
                console.error("Error getting location: ", error);
                let msg = "Location Error!";
                if (error.code === error.PERMISSION_DENIED) {
                    msg = "GPS Permission Denied! Enable location services.";
                    alert("GPS permission was denied. Please enable location services in your browser/device settings.");
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    msg = "GPS Signal Unavailable!";
                } else if (error.code === error.TIMEOUT) {
                    msg = "GPS Request Timed Out!";
                }
                document.getElementById("instruction").innerText = msg;
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    } else {
        document.getElementById("instruction").innerText = "GPS not supported on this device/connection";
        alert("GPS geolocation is not supported or is blocked. If on mobile, please make sure you are using a secure HTTPS connection.");
    }
}

function setDestination(lat, lon) {
    targetLat = lat;
    targetLon = lon;
    if (userLat !== null && userLon !== null) {
        calculateCustomRoute();
    } else {
        // Wait for GPS watchPosition to trigger calculation
        document.getElementById("instruction").innerText = "Waiting for GPS to calculate custom route...";
    }
}

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

// Compute bearing (0-360, 0 = North, clockwise) from point A to point B
function bearing(lat1, lon1, lat2, lon2) {
    const dLon = toRadians(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
    const x = Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
              Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function startCompass() {
    deviceOrientationListener = function (event) {
        let heading = null;
        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
            heading = event.webkitCompassHeading;
            compassAccuracy = event.webkitCompassAccuracy !== null ? event.webkitCompassAccuracy : null;
        } else if (event.alpha !== null) {
            heading = event.alpha;
        }
        if (heading !== null) {
            compassHeading = heading;
        }
    };
    window.addEventListener('deviceorientation', deviceOrientationListener, true);

    // AbsoluteOrientationSensor (newer API on Android Chrome) — most accurate
    if (typeof AbsoluteOrientationSensor !== 'undefined') {
        try {
            absoluteOrientationSensor = new AbsoluteOrientationSensor({ frequency: 60 });
            absoluteOrientationSensor.addEventListener('reading', () => {
                const q = absoluteOrientationSensor.quaternion;
                const heading = Math.atan2(
                    2 * (q[0] * q[3] + q[1] * q[2]),
                    1 - 2 * (q[2] * q[2] + q[3] * q[3])
                ) * (180 / Math.PI);
                compassHeading = (heading + 360) % 360;
            });
            absoluteOrientationSensor.start();
        } catch (e) {
            console.warn("AbsoluteOrientationSensor not available:", e);
        }
    }
}

function stopCompass() {
    if (deviceOrientationListener) {
        window.removeEventListener('deviceorientation', deviceOrientationListener, true);
        deviceOrientationListener = null;
    }
    if (absoluteOrientationSensor) {
        absoluteOrientationSensor.stop();
        absoluteOrientationSensor = null;
    }
    compassHeading = null;
    compassAccuracy = null;
}

// =========================================================================
// DESTINATION PICKER — full-screen map with click-to-set + Nominatim search
// =========================================================================

let pickerMap = null;
let pickerMarker = null;
let _selectedLat = null, _selectedLon = null;

function initDestinationPicker() {
    if (pickerMap) return;

    pickerMap = L.map('picker-map', {
        zoomControl: true,
        attributionControl: true
    }).setView([10.678645, 77.032418], 18);

    L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 22,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    }).addTo(pickerMap);

    pickerMap.on('click', function (e) {
        setPickedDestination(e.latlng.lat, e.latlng.lng, null);
    });
}

function setPickedDestination(lat, lng, label) {
    _selectedLat = lat;
    _selectedLon = lng;

    if (pickerMarker) pickerMap.removeLayer(pickerMarker);
    pickerMarker = L.marker([lat, lng]).addTo(pickerMap);

    document.getElementById('selected-coords').innerText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    document.getElementById('picker-instruction').innerText = label || '📍 Destination set — tap Start to navigate';
    document.getElementById('start-nav-btn').style.display = 'block';
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
                        pickerMap.setView([parseFloat(r.lat), parseFloat(r.lon)], 19);
                        setPickedDestination(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
                        resultsEl.style.display = "none";
                        document.getElementById("search-input").value = "";
                    };
                    resultsEl.appendChild(div);
                });
            })
            .catch(() => {});
    }, 500);
}

// System Entry point — called by "Start Navigation" button
function startAR() {
    if (_selectedLat === null || _selectedLon === null) return;

    // 1. Immediately request motion/orientation permission on iOS if required
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        document.getElementById("instruction").innerText = "Requesting compass permission...";
        
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    proceedWithAR(true);
                } else {
                    console.warn("Orientation permission denied.");
                    alert("Orientation permission denied. Compass orientation may not work.");
                    proceedWithAR(false);
                }
            })
            .catch(err => {
                console.error("Device orientation request failed:", err);
                alert("Could not request orientation permission. Please ensure you are using a secure connection (HTTPS).");
                proceedWithAR(false);
            });
    } else {
        // Non-iOS device or older browser
        proceedWithAR(true);
    }
}

function proceedWithAR(orientationGranted) {
    document.getElementById("destination-picker").style.display = "none";
    document.getElementById("ui-overlay").style.display = "block";
    document.getElementById("ar-destination-title").innerText =
        `${_selectedLat.toFixed(6)}, ${_selectedLon.toFixed(6)}`;
    hasStarted = true;

    // Set target FIRST so GPS callback triggers route calculation immediately
    targetLat = _selectedLat;
    targetLon = _selectedLon;

    // Start camera + GPS immediately
    startCamera();
    getLocation();

    // Init 3D scene and minimap
    init3D();
    initMap();

    // Start gyroscope + compass for accurate heading if permission granted
    if (orientationGranted) {
        startCompass();
    }
}

function stopAR() {
    hasStarted = false;
    document.getElementById("destination-picker").style.display = "flex";
    document.getElementById("ui-overlay").style.display = "none";
    document.getElementById("instruction").innerText = "Waiting for GPS...";

    const video = document.getElementById('camera-feed');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    if (renderer) {
        document.getElementById("container").innerHTML = "";
    }
    stopCompass();
    scene = null;
    camera = null;
    renderer = null;
    controls = null;
    pathLine = null;
    destinationObject = null;
    pathArrows = [];
    routeCoordinates = [];

    if (leafletMap) {
        leafletMap.remove();
        leafletMap = null;
        userMarker = null;
        targetMarker = null;
        mapRouteLine = null;
        isMapExpanded = false;
        document.getElementById("minimap-container").classList.remove("expanded");
        document.getElementById("toggle-map-btn").innerText = "⛶ Expand";
    }

    setTimeout(() => { if (pickerMap) pickerMap.invalidateSize(); }, 100);
}

function initMap() {
    if (leafletMap) return;

    leafletMap = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([10.641123, 77.029058], 15); // Default campus center

    // Google Maps Tile Layer
    L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    }).addTo(leafletMap);
}

function toggleMap() {
    isMapExpanded = !isMapExpanded;
    const container = document.getElementById("minimap-container");
    const btn = document.getElementById("toggle-map-btn");

    if (isMapExpanded) {
        container.classList.add("expanded");
        btn.innerText = "⛕ Collapse";
    } else {
        container.classList.remove("expanded");
        btn.innerText = "⛶ Expand";
    }

    setTimeout(() => {
        if (leafletMap) leafletMap.invalidateSize();
    }, 350);
}

function startCamera() {
    const video = document.getElementById('camera-feed');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        document.getElementById("instruction").innerText = "Camera not supported on this device";
        return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(stream => { video.srcObject = stream; })
        .catch(err => {
            console.error("Camera access denied.", err);
            document.getElementById("instruction").innerText = "Camera permission denied — navigation continues without AR view";
        });
}

// Like functionality
let isLiked = false;
function toggleLike() {
    isLiked = !isLiked;
    const btn = document.getElementById('like-btn');
    if (isLiked) {
        btn.classList.add('liked'); btn.innerHTML = "💖 Liked";
    } else {
        btn.classList.remove('liked'); btn.innerHTML = "❤️ Like";
    }
}

// Initialize the destination picker on page load
document.addEventListener('DOMContentLoaded', function () {
    initDestinationPicker();
    
    // Check if running in insecure context
    if (!window.isSecureContext) {
        const warningBanner = document.getElementById("secure-context-warning");
        if (warningBanner) {
            warningBanner.style.display = "block";
        }
    }
});

