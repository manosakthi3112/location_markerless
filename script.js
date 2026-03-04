let scene, camera, renderer, controls;
let userLat = null, userLon = null;
let targetLat = null, targetLon = null;
let destinationObject = null;
let pathLine = null;
let pathArrows = [];
let maxArrows = 15;
let arrowSpacing = 4.5; // meters
let hasStarted = false;

// 1 degree of latitude is ~111km. So 111,000 meters
const M_PER_DEG_LAT = 111320;
let initialLat = null, initialLon = null;

function createRoadArrow() {
    // Street View Chevron Shape
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.2);
    shape.lineTo(1.2, -0.4);
    shape.lineTo(0.8, -0.7);
    shape.lineTo(0, 0.4);
    shape.lineTo(-0.8, -0.7);
    shape.lineTo(-1.2, -0.4);
    shape.lineTo(0, 1.2);

    const geometry = new THREE.ShapeGeometry(shape);
    // Soft white color like Google Street View
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.02; // elevate slightly above shadow

    // Drop shadow chevron for depth
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    const shadowMesh = new THREE.Mesh(geometry, shadowMat);
    shadowMesh.rotation.x = Math.PI / 2;
    shadowMesh.scale.set(1.1, 1.1, 1.1);
    shadowMesh.position.set(0, -0.01, -0.1);

    const group = new THREE.Group();
    group.add(mesh);
    group.add(shadowMesh);
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

function updateDestinationObject() {
    if (userLat === null || targetLat === null) return;

    // We treat the *first* GPS location as (0,0) in our 3D world, 
    // or just dynamically move the target relative to our current (0,0) camera.
    // For simplicity, we keep the camera at (0,0,0) and move the world objects relative to it.

    const dx = (targetLon - userLon) * (111320 * Math.cos(toRadians(userLat)));
    const dz = (userLat - targetLat) * 111320; // +z is South in webgl, so (user-target) is correct

    // Create target if it doesn't exist
    if (!destinationObject) {
        const geom = new THREE.CylinderGeometry(0, 1, 4, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
        destinationObject = new THREE.Mesh(geom, mat);
        scene.add(destinationObject);

        // Add a pulsing ring below it
        const ringGeom = new THREE.RingGeometry(1, 1.5, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -2;
        destinationObject.add(ring);
    }

    // Set absolute position relative to camera at (0,0,0)
    destinationObject.position.set(dx, 0, dz);

    // Update Path Line pointing strictly from below camera to the target
    if (!pathLine) {
        const lineMaterial = new THREE.LineDashedMaterial({
            color: 0x00aa00,
            linewidth: 3,
            dashSize: 1,
            gapSize: 0.5,
            transparent: true,
            opacity: 0.5
        });
        const lineGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -2, 0),
            new THREE.Vector3(0, -2, -10) // temp
        ]);
        pathLine = new THREE.Line(lineGeom, lineMaterial);
        scene.add(pathLine);
    }

    // Line array: from beneath the user up to the destination
    pathLine.geometry.setFromPoints([
        new THREE.Vector3(0, -2, 0),
        new THREE.Vector3(dx, -2, dz)
    ]);
    pathLine.computeLineDistances();
}

function animate() {
    requestAnimationFrame(animate);

    if (hasStarted && controls) {
        controls.update();
    }

    // Animate dash offset for the track line to look like a moving path
    if (pathLine && pathLine.material) {
        pathLine.material.dashOffset -= 0.05;
    }

    if (destinationObject) {
        destinationObject.rotation.y += 0.02; // spin

        const dx = destinationObject.position.x;
        const dz = destinationObject.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.1) {
            const dirX = dx / dist;
            const dirZ = dz / dist;
            const angle = Math.atan2(dx, dz);

            const speed = 1.0; // slower floating pace
            const time = Date.now() * 0.001;

            for (let i = 0; i < maxArrows; i++) {
                let offset = (time * speed + i * arrowSpacing) % Math.max(dist, arrowSpacing * maxArrows);
                if (offset < dist && offset > 1) { // starts slightly in front of user
                    pathArrows[i].visible = true;
                    pathArrows[i].position.set(dirX * offset, -1.9, dirZ * offset); // slightly above line
                    pathArrows[i].rotation.y = angle;

                    // fade out near destination or camera
                    let opacity = 0.8;
                    if (offset < 4) opacity = ((offset - 1) / 3) * 0.8;
                    if (dist - offset < 2) opacity = (dist - offset) / 2 * 0.8;

                    pathArrows[i].children.forEach(c => {
                        if (c.material) c.material.opacity = Math.max(0, opacity);
                    });
                } else {
                    pathArrows[i].visible = false;
                }
            }
        }
    }

    updateInstructions();

    renderer.render(scene, camera);
}

function updateInstructions() {
    if (!destinationObject || !hasStarted) return;

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

    let instruction = "Look Around \u21bb";
    if (dot > 0.9) { // ~25 deg FOV
        instruction = "\u2191 Target Ahead";
    } else if (angle > 15) {
        instruction = "\u2190 Turn Left";
    } else if (angle < -15) {
        instruction = "Turn Right \u2192";
    } else if (dot < 0) {
        instruction = "Turn Around \u21bb";
    }

    document.getElementById("instruction").innerText = instruction;
}


function getLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            position => {
                userLat = position.coords.latitude;
                userLon = position.coords.longitude;
                updateDestinationObject();
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
    updateDestinationObject();
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