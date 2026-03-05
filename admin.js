// Admin Graph Mapping Tool

let map;
let markers = [];
let pointIdCounter = 1;

function initAdminMap() {
    map = L.map('map').setView([10.678173, 77.03264], 18); // Default campus center

    // Google Satellite Tile Layer
    L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 22,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    }).addTo(map);

    // Map Click Event
    map.on('click', function (e) {
        let lat = e.latlng.lat;
        let lng = e.latlng.lng;
        addPoint(lat, lng);
    });
}

function addPoint(lat, lng) {
    let id = 'n' + pointIdCounter++;

    let marker = L.circleMarker([lat, lng], {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.8,
        radius: 6
    }).addTo(map);

    marker.bindTooltip(id, { permanent: false });

    // Allow deleting points by clicking on them
    marker.on('click', function (e) {
        L.DomEvent.stopPropagation(e); // prevent triggering map click
        map.removeLayer(marker);
        markers = markers.filter(m => m.id !== id);
        drawConnections();
    });

    markers.push({
        id: id,
        lat: lat,
        lon: lng,
        layer: marker
    });

    drawConnections();
}

let connectionLines = [];
function drawConnections() {
    // Clear old lines
    connectionLines.forEach(l => map.removeLayer(l));
    connectionLines = [];

    // Max distance to connect (meters)
    const MAX_CONNECT_DIST = 20;

    for (let i = 0; i < markers.length; i++) {
        for (let j = i + 1; j < markers.length; j++) {
            let p1 = markers[i];
            let p2 = markers[j];

            let dist = calculateDistance(p1.lat, p1.lon, p2.lat, p2.lon);
            if (dist <= MAX_CONNECT_DIST) {
                let line = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], { color: 'rgba(255, 255, 255, 0.5)', weight: 2 }).addTo(map);
                connectionLines.push(line);
            }
        }
    }
}

function clearMap() {
    if (confirm("Are you sure you want to clear all points?")) {
        markers.forEach(m => map.removeLayer(m.layer));
        markers = [];
        pointIdCounter = 1;
        drawConnections();
    }
}

function exportGraph() {
    if (markers.length === 0) {
        alert("No points placed yet!");
        return;
    }

    let exportData = {};
    markers.forEach(m => {
        exportData[m.id] = { lat: m.lat, lon: m.lon };
    });

    let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 4));
    let downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "campus_nodes.json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function toRadians(deg) { return deg * (Math.PI / 180); }
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Start
initAdminMap();
