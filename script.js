let scene, camera, renderer, arrow, directionGroup, trackLine;
let userLat, userLon;
let targetLat, targetLon;
let deviceHeading = 0;

init3D();
getLocation();
getOrientation();

function init3D() {

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0); // Transparent background
    document.getElementById("container").appendChild(renderer.domElement);

    directionGroup = new THREE.Group();
    scene.add(directionGroup);

    // Create arrow
    const geometry = new THREE.ConeGeometry(0.5, 2, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    arrow = new THREE.Mesh(geometry, material);
    directionGroup.add(arrow);

    // Create track line
    const lineMaterial = new THREE.LineDashedMaterial({
        color: 0x00ff00,
        linewidth: 2,
        dashSize: 0.5,
        gapSize: 0.3,
    });
    const linePoints = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 15, 0)
    ];
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
    trackLine = new THREE.Line(lineGeometry, lineMaterial);
    trackLine.computeLineDistances();
    directionGroup.add(trackLine);

    directionGroup.rotation.x = Math.PI / 2;

    camera.position.z = 5;

    animate();
}

function animate() {
    requestAnimationFrame(animate);

    // Animate the track line
    if (trackLine && trackLine.material) {
        trackLine.material.dashOffset -= 0.05;
    }

    renderer.render(scene, camera);
}

function getLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            position => {
                userLat = position.coords.latitude;
                userLon = position.coords.longitude;
                updateDirection();
            },
            error => {
                console.error("Error getting location: ", error);
                document.getElementById("instruction").innerText = "Location Error!";
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );
    } else {
        console.error("Geolocation not supported");
        document.getElementById("instruction").innerText = "GPS Not Supported";
    }
}

function setDestination(lat, lon) {
    targetLat = lat;
    targetLon = lon;
    updateDirection();
}

function getOrientation() {
    window.addEventListener("deviceorientationabsolute", event => {
        if (event.alpha !== null) {
            deviceHeading = 360 - event.alpha;
            updateDirection();
        }
    });

    window.addEventListener("deviceorientation", event => {
        if (event.webkitCompassHeading) {
            deviceHeading = event.webkitCompassHeading;
        } else if (event.alpha !== null) {
            deviceHeading = 360 - event.alpha;
        }
        updateDirection();
    });
}

function toRadians(deg) {
    return deg * (Math.PI / 180);
}

function toDegrees(rad) {
    return rad * (180 / Math.PI);
}

function calculateBearing(lat1, lon1, lat2, lon2) {

    const dLon = toRadians(lon2 - lon1);

    const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
    const x =
        Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
        Math.sin(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.cos(dLon);

    let brng = toDegrees(Math.atan2(y, x));
    return (brng + 360) % 360;
}

function calculateDistance(lat1, lon1, lat2, lon2) {

    const R = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function updateDirection() {

    if (userLat == null || targetLat == null || deviceHeading == null) return;

    const bearing = calculateBearing(userLat, userLon, targetLat, targetLon);
    let rotation = bearing - deviceHeading;

    // Normalize rotation to -180 to 180 degrees
    if (rotation > 180) {
        rotation -= 360;
    } else if (rotation < -180) {
        rotation += 360;
    }

    if (directionGroup) {
        // Invert rotation so pointing Left/Right maps well onto Z-axis rotation
        directionGroup.rotation.z = toRadians(-rotation);
    }

    // Determine Turn Instruction
    let instruction = "Go Straight";
    if (rotation > 15 && rotation < 165) {
        instruction = "Turn Right \u2192";
    } else if (rotation < -15 && rotation > -165) {
        instruction = "\u2190 Turn Left";
    } else if (Math.abs(rotation) >= 165) {
        instruction = "Turn Around \u21bb";
    } else {
        instruction = "\u2191 Go Straight";
    }

    const instructionEl = document.getElementById("instruction");
    if (instructionEl) instructionEl.innerText = instruction;

    const distance = calculateDistance(userLat, userLon, targetLat, targetLon);
    const distanceEl = document.getElementById("distance");
    if (distanceEl) {
        if (distance > 1000) {
            distanceEl.innerText = "Distance: " + (distance / 1000).toFixed(2) + " km";
        } else {
            distanceEl.innerText = "Distance: " + distance.toFixed(0) + " meters";
        }
    }
}

// Open device camera for markerless AR background
function startCamera() {
    const video = document.getElementById('camera-feed');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
            .then(function (stream) {
                video.srcObject = stream;
            })
            .catch(function (error) {
                console.error("Camera access denied or unavailable.", error);
            });
    } else {
        console.warn("getUserMedia not supported in this browser.");
    }
}
startCamera();

// Like button functionality
let isLiked = false;
function toggleLike() {
    isLiked = !isLiked;
    const btn = document.getElementById('like-btn');
    if (isLiked) {
        btn.classList.add('liked');
        btn.innerHTML = "💖 Liked";
    } else {
        btn.classList.remove('liked');
        btn.innerHTML = "❤️ Like";
    }
}