let scene, camera, renderer, controls;
let userLat = null, userLon = null;
let targetLat = null, targetLon = null;
let destinationObject = null;
let pathLine = null;
let pathArrows = [];
let maxArrows = 15;
let arrowSpacing = 2.0; // meters (denser)
let hasStarted = false;

// Routing API Globals
let routeCoordinates = []; // GeoJSON [lon, lat] array from OSRM
let routeCurve = null;     // THREE.CatmullRomCurve3
let routeLength = 0;       // Length of the spline curve

// Constants for Progressive Rendering
const VISIBLE_PATH_AHEAD = 30; // Show exactly 30 meters of track line ahead so turns are visible

// 1 degree of latitude is ~111km. So 111,000 meters
const M_PER_DEG_LAT = 111320;
let initialLat = null, initialLon = null;

function createRoadArrow() {
    // Street View Chevron Shape (more reasonably sized)
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.5);
    shape.lineTo(1.5, -0.5);
    shape.lineTo(1.0, -0.9);
    shape.lineTo(0, 0.5);
    shape.lineTo(-1.0, -0.9);
    shape.lineTo(-1.5, -0.5);
    shape.lineTo(0, 1.5);

    const geometry = new THREE.ShapeGeometry(shape);
    // Bold white color like Google Street View
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.05; // elevate slightly above shadow

    // Deeper Drop shadow chevron
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const shadowMesh = new THREE.Mesh(geometry, shadowMat);
    shadowMesh.rotation.x = Math.PI / 2;
    shadowMesh.scale.set(1.15, 1.15, 1.15);
    shadowMesh.position.set(0, 0.01, -0.2);

    const group = new THREE.Group();
    group.add(mesh);
    group.add(shadowMesh);

    // Scale moderately so perspective works better over distance
    group.scale.set(0.7, 0.7, 0.7);

    return group;
}

function init3D() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // Add DeviceOrientationControls
    controls = new THREE.DeviceOrientationControls(camera, true);

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

async function fetchRoute() {
    if (!userLat || !userLon || !targetLat || !targetLon) return;

    document.getElementById("instruction").innerText = "Fetching Map Route...";

    // OSRM Public API for walking routing (returns GeoJSON LineString)
    const url = `https://router.project-osrm.org/route/v1/walking/${userLon},${userLat};${targetLon},${targetLat}?geometries=geojson`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            routeCoordinates = data.routes[0].geometry.coordinates; // Array of [lon, lat]
            updateRoute3D();
        }
    } catch (e) {
        console.error("Routing Error:", e);
        document.getElementById("instruction").innerText = "Map API Error";
        updateRoute3D(); // fallback to straight line
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
                const angle = Math.atan2(tangent.x, tangent.z);
                pathArrows[i].rotation.y = angle;

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

    // Calculate angle difference between camera viewing direction and CURRENT path direction
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0; // project to XZ plane
    cameraDirection.normalize();

    let targetDirection = new THREE.Vector3();

    // If we have a smooth curved route, measure the angle to the immediate chunk of road ahead (e.g. 5 meters)
    if (routeCurve && routeLength > 5) {
        let lookAheadDistance = 5;
        let t = lookAheadDistance / routeLength;
        if (t > 1) t = 1;

        const pathPoint = routeCurve.getPointAt(t);
        targetDirection.set(pathPoint.x, 0, pathPoint.z).normalize();
    } else if (destinationObject) {
        // Fallback to absolute destination if route hasn't loaded 
        targetDirection.set(destinationObject.position.x, 0, destinationObject.position.z).normalize();
    }

    // Cross product to get left/right, dot product for forward/backward
    const cross = new THREE.Vector3().crossVectors(cameraDirection, targetDirection);
    const dot = cameraDirection.dot(targetDirection);
    const angle = Math.atan2(cross.y, dot) * (180 / Math.PI); // degrees

    const navIcon = document.getElementById("nav-arrow");

    let instruction = "Orienting...";
    let arrowIcon = "🔄";

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

    document.getElementById("instruction").innerText = instruction;
    if (navIcon) navIcon.innerText = arrowIcon;
}


function getLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            position => {
                const initFetching = (userLat === null && targetLat !== null);
                userLat = position.coords.latitude;
                userLon = position.coords.longitude;

                const coordsEl = document.getElementById("current-coords");
                if (coordsEl) {
                    coordsEl.innerText = `My Location: ${userLat.toFixed(6)}, ${userLon.toFixed(6)}`;
                }

                // If it's the first GPS lock after choosing destination, fetch the map route
                if (initFetching || routeCoordinates.length === 0) {
                    if (targetLat !== null) fetchRoute();
                } else {
                    // Otherwise just update the relative 3D path based on new coords
                    updateRoute3D();
                }
            },
            error => {
                console.error("Error getting location: ", error);
                document.getElementById("instruction").innerText = "Location Error!";
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    }
}

function setDestination(lat, lon) {
    targetLat = lat;
    targetLon = lon;
    if (userLat !== null && userLon !== null) {
        fetchRoute();
    } else {
        // Wait for GPS watchPosition to trigger fetchRoute
        document.getElementById("instruction").innerText = "Waiting for GPS to map route...";
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

// ================= MENU LOGIC =================

const MENU_DATA = {
    'Classrooms': [
        { name: 'Room 101', lat: 10.6415, lon: 77.0295 },
        { name: 'Room 102', lat: 10.6416, lon: 77.0296 }
    ],
    'Labs': [
        { name: 'Physics Lab', lat: 10.6418, lon: 77.0298 },
        { name: 'Computer Lab', lat: 10.6419, lon: 77.0299 }
    ],
    'Offices': [
        { name: 'Admin Block', lat: 10.6420, lon: 77.0300 },
        { name: 'Dean Office', lat: 10.6421, lon: 77.0301 }
    ],
    'Cafeteria': [
        { name: 'Main Canteen', lat: 10.6425, lon: 77.0305 }
    ],
    'Restrooms': [
        { name: 'Restroom A', lat: 10.6412, lon: 77.0292 }
    ]
};

function showCategories() {
    document.getElementById("categories-view").style.display = "block";
    document.getElementById("locations-view").style.display = "none";
}

function showLocations(category) {
    document.getElementById("categories-view").style.display = "none";
    document.getElementById("locations-view").style.display = "block";
    document.getElementById("category-title").innerText = category;

    const list = document.getElementById("locations-list");
    list.innerHTML = ""; // Clear existing

    if (MENU_DATA[category]) {
        MENU_DATA[category].forEach(loc => {
            const btn = document.createElement("button");
            btn.className = "menu-btn";
            btn.innerText = loc.name;
            btn.onclick = () => startAR(loc.name, loc.lat, loc.lon);
            list.appendChild(btn);
        });
    }
}

// System Entry point for interactions
function startAR(destinationName, lat, lon) {
    document.getElementById("menu-overlay").style.display = "none";
    document.getElementById("ui-overlay").style.display = "block";
    document.getElementById("ar-destination-title").innerText = destinationName;
    hasStarted = true;

    // Start 3D
    init3D();

    // Set target first
    targetLat = lat;
    targetLon = lon;

    // Request permission for iOS 13+ device orientation
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    getLocation();
                    startCamera();
                } else {
                    alert("Orientation access denied. Cannot use AR.");
                }
            })
            .catch(console.error);
    } else {
        // Non-iOS 13+ path
        getLocation();
        startCamera();
    }
}

function stopAR() {
    hasStarted = false;
    document.getElementById("menu-overlay").style.display = "flex";
    document.getElementById("ui-overlay").style.display = "none";
    document.getElementById("instruction").innerText = "Waiting for GPS...";

    // Stop camera
    const video = document.getElementById('camera-feed');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    // Clean up 3D Scene to save RAM
    if (renderer) {
        document.getElementById("container").innerHTML = "";
    }
    scene = null;
    camera = null;
    renderer = null;
    controls = null;
    pathLine = null;
    destinationObject = null;
    pathArrows = [];
    routeCoordinates = [];

    showCategories();
}

function startCamera() {
    const video = document.getElementById('camera-feed');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
            .then(stream => { video.srcObject = stream; })
            .catch(err => { console.error("Camera access denied.", err); });
    }
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