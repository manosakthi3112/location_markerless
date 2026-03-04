let scene, camera, renderer, controls;
let userLat = null, userLon = null;
let targetLat = null, targetLon = null;
let destinationObject = null;
let pathLine = null;
let pathArrows = [];
let maxArrows = 15;
let arrowSpacing = 5.0; // meters
let hasStarted = false;

// Routing API Globals
let routeCoordinates = []; // GeoJSON [lon, lat] array from OSRM
let routeCurve = null;     // THREE.CatmullRomCurve3
let routeLength = 0;       // Length of the spline curve

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

    if (routeCoordinates.length > 0) {
        // Convert all geo-coordinates to local 3D points relative to user camera (0,0,0)
        for (let coord of routeCoordinates) {
            const cLon = coord[0];
            const cLat = coord[1];
            const dx = (cLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
            const dz = (userLat - cLat) * 111320; // +z is South in webgl
            points.push(new THREE.Vector3(dx, -1.9, dz)); // Place on ground
        }
    } else {
        // Fallback: Straight line to target
        const dx = (targetLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
        const dz = (userLat - targetLat) * 111320;
        points.push(new THREE.Vector3(0, -1.9, 0));
        points.push(new THREE.Vector3(dx, -1.9, dz));
    }

    // Update Path Line Geometry
    if (!pathLine) {
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff00,
            linewidth: 5,
        });
        const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
        pathLine = new THREE.Line(lineGeom, lineMaterial);
        scene.add(pathLine);
    } else {
        pathLine.geometry.setFromPoints(points);
        pathLine.computeLineDistances();
    }

    // Create Spline Curve for arrows to follow
    if (points.length >= 2) {
        // We use CatmullRomCurve3 to get a smooth path and easily calculate tangent angles
        routeCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.1);
        routeLength = routeCurve.getLength();
    }

    // Update Destination Object (Marker) at the very last point
    const lastPoint = points[points.length - 1];
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
    destinationObject.position.set(lastPoint.x, 0, lastPoint.z);
}

function animate() {
    requestAnimationFrame(animate);

    if (hasStarted && controls) {
        controls.update();
    }

    // No need to animate dash offset anymore since line is solid

    // Animate Arrows along the Spline Curve
    if (routeCurve && routeLength > 0.1) {
        const speed = 2.5; // units per second
        const time = Date.now() * 0.001;

        for (let i = 0; i < maxArrows; i++) {
            let rawDist = (time * speed + i * arrowSpacing);
            // Cycle arrows within a max visual distance (e.g. 50 meters)
            let maxViewWalk = Math.min(routeLength, 50);
            let distAlong = rawDist % maxViewWalk;

            // Parametric 't' value [0, 1] along the full curve
            let t = distAlong / routeLength;
            if (t > 1) t = 1;

            if (distAlong > 0.5) { // offset from feet
                pathArrows[i].visible = true;

                // 1) Get exact point on the curved road
                const pt = routeCurve.getPointAt(t);
                pathArrows[i].position.set(pt.x, -1.9, pt.z); // strictly on ground

                // 2) Get exact tangent (direction) of the road at that point
                const tangent = routeCurve.getTangentAt(t).normalize();
                const angle = Math.atan2(tangent.x, tangent.z);
                pathArrows[i].rotation.y = angle;

                // 3) Fading math
                let opacity = 0.9;
                if (distAlong < 3) opacity = (distAlong / 3) * 0.9;
                if (maxViewWalk - distAlong < 5) opacity = ((maxViewWalk - distAlong) / 5) * 0.9;

                pathArrows[i].children.forEach(c => {
                    if (c.material) c.material.opacity = Math.max(0, opacity);
                });
            } else {
                pathArrows[i].visible = false;
            }
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

    // Calculate angle difference between camera viewing direction and target direction
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0; // project to XZ plane
    cameraDirection.normalize();

    const targetDirection = new THREE.Vector3(
        destinationObject.position.x,
        0,
        destinationObject.position.z
    ).normalize();

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

// System Entry point for interactions
function startAR() {
    document.getElementById("start-overlay").style.display = "none";
    document.getElementById("ui-overlay").style.display = "block";
    hasStarted = true;

    // Start 3D
    init3D();

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