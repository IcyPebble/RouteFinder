const socket = io();

socket.once("connect", () => {
    let tempId = document.getElementById("tempId");
    socket.emit("connectionEstablished", tempId.innerText);
})

var imgData;
socket.on("image", (dataURL) => {
    imgData = dataURL;
})

function getObjectFitSize(contains, containerWidth, containerHeight, width, height) {
    var doRatio = width / height;
    var cRatio = containerWidth / containerHeight;
    var targetWidth = 0;
    var targetHeight = 0;
    var test = contains ? (doRatio > cRatio) : (doRatio < cRatio);

    if (test) {
        targetWidth = containerWidth;
        targetHeight = targetWidth / doRatio;
    } else {
        targetHeight = containerHeight;
        targetWidth = targetHeight * doRatio;
    }

    return {
        width: targetWidth,
        height: targetHeight,
        x: (containerWidth - targetWidth) / 2,
        y: (containerHeight - targetHeight) / 2
    };
}

function enableZoom(element, zoomPerDiagonal, maxZoom) {
    let container = document.createElement("div");
    container.className = "zoomContainer";
    element.parentElement.insertBefore(container, element);
    container.replaceChildren(element);
    container.style.width = element.clientWidth + "px";
    container.style.height = element.clientHeight + "px";

    let registeredPointers = [];
    let registeredPointerIds = [];
    let dist;
    let startPos;
    container.onpointerdown = (e) => {
        if (registeredPointers.length < 2) {
            registeredPointers.push(e);
            registeredPointerIds.push(e.pointerId);
        }
        if (registeredPointers.length == 2) {
            let [x1, x2] = registeredPointers.map((p) => p.clientX);
            let [y1, y2] = registeredPointers.map((p) => p.clientY);
            dist = Math.hypot(x2 - x1, y2 - y1);
            startPos = [(x1 + x2) / 2, (y1 + y2) / 2];
            currTranslation = [0, 0];
            translationSaved = false;
        }
    }

    let translation = [0, 0];
    let translationSaved = false;
    container.onpointerup = (e) => {
        let idx = registeredPointerIds.indexOf(e.pointerId);
        if (idx > -1) {
            registeredPointers.splice(idx, 1);
            registeredPointerIds.splice(idx, 1);
            dist = undefined;
            startPos = undefined;
            if (!translationSaved) {
                translation[0] += currTranslation[0];
                translation[1] += currTranslation[1];
                translationSaved = true;
            }
        }
    }

    let diagonalLength = Math.hypot(container.clientWidth, container.clientHeight);
    let currZoom = 1;
    let currTranslation = [0, 0];
    container.onpointermove = (e) => {
        if (registeredPointerIds.includes(e.pointerId) && dist) {
            registeredPointers[registeredPointerIds.indexOf(e.pointerId)] = e;
            let [x1, x2] = registeredPointers.map((p) => p.clientX);
            let [y1, y2] = registeredPointers.map((p) => p.clientY);
            let newDist = Math.hypot(x2 - x1, y2 - y1);
            let newPos = [(x1 + x2) / 2, (y1 + y2) / 2];

            // move
            currTranslation[0] = newPos[0] - startPos[0];
            currTranslation[1] = newPos[1] - startPos[1];
            container.style.setProperty("--translate-x", translation[0] + currTranslation[0] + "px");
            container.style.setProperty("--translate-y", translation[1] + currTranslation[1] + "px");

            if (newDist < dist) { // pinch
                let pinch = -((dist - newDist) / diagonalLength) * zoomPerDiagonal;
                let scale = (currZoom + pinch > 1) ? currZoom + pinch : 1;

                container.style.setProperty("--scale", scale);

                currZoom = scale;

            } else if (newDist > dist) { // zoom
                let zoom = ((newDist - dist) / diagonalLength) * zoomPerDiagonal;
                let scale = (currZoom + zoom < maxZoom) ? currZoom + zoom : maxZoom;

                container.style.setProperty("--scale", scale);

                currZoom = scale;
            }

            dist = newDist;
        }
    }

    return container;
}

function showResultOverlay(img) {
    img.style.backgroundImage = `url("static/show_image.svg"), linear-gradient(rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.4)), url("${imgData.url}")`;
}

function hideResultOverlay(img) {
    img.style.backgroundImage = `url("static/hide_image.svg")`;
}

function toggleResultOverlay(img) {
    img.style.backgroundImage = (
        img.style.backgroundImage == `url("static/hide_image.svg")`
    ) ? `url("static/show_image.svg"), linear-gradient(rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.4)), url("${imgData.url}")` : `url("static/hide_image.svg")`;
}

var screen = document.getElementById("screen");
var dialog = document.getElementById("dialog");
var dialogTitle = document.getElementById("dialogTitle");
var dialogContent = document.getElementById("dialogContent");
var dialogContinueBtn = document.getElementById("dialogContinueBtn");
var dialogReadjustBtn = document.getElementById("dialogReadjustBtn");

socket.on("cropImg", (dataURL) => {
    dialog.style.display = "flex";

    cropImg_dialog(dataURL);
});

function cropImg_dialog(dataURL) {
    dialogContinueBtn.classList.remove("loading");
    dialogTitle.innerHTML = "Crop image";
    dialogContinueBtn.disabled = false;
    dialogReadjustBtn.disabled = true;

    let cropImgDialogImg = new Image();
    cropImgDialogImg.id = "cropImgDialogImg";
    cropImgDialogImg.className = "resultDialogImg";

    let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "clipOverlay");
    let polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("fill", "none");
    polygon.setAttribute("stroke", "black");
    svg.appendChild(polygon);

    let marginTop = (matchMedia("only screen and (max-width: 768px)").matches) ? "0px" : "4vw";
    cropImgDialogImg.style.marginTop = "0vw";
    svg.style.marginTop = "0vw";

    container = document.createElement("div");
    container.replaceChildren(cropImgDialogImg, svg);
    dialogContent.replaceChildren(container);

    enableZoom(container, 2, 4).style.marginTop = marginTop;

    let cropImgArgs = { points: [] }
    cropImgDialogImg.src = dataURL;
    cropImgDialogImg.onload = () => {
        cropImgDialogImg.onclick = (e) => {
            let size = getObjectFitSize(true, cropImgDialogImg.width, cropImgDialogImg.height, cropImgDialogImg.naturalWidth, cropImgDialogImg.naturalHeight);

            let x = e.offsetX - Math.floor((cropImgDialogImg.width - size.width) / 2);
            let y = e.offsetY - Math.floor((cropImgDialogImg.height - size.height) / 2);
            if (
                ((0 < x) && (x < size.width)) && ((0 < y) && (y < size.height))
            ) {
                let points = polygon.getAttribute("points") || "";
                points += `${e.offsetX},${e.offsetY} `;
                polygon.setAttribute("points", points);

                let point = document.createElementNS("http://www.w3.org/2000/svg", "image");
                point.setAttribute("class", "clipPoint");
                point.setAttribute("href", "../static/clip_point.svg");
                point.setAttribute("x", e.offsetX);
                point.setAttribute("y", e.offsetY);
                svg.appendChild(point);

                x = Math.floor((x / size.width) * cropImgDialogImg.naturalWidth);
                y = Math.floor((y / size.height) * cropImgDialogImg.naturalHeight);

                let count = cropImgArgs.points.push([y, x]);

                if (count >= 3) {
                    dialogContinueBtn.disabled = false;
                } else {
                    dialogContinueBtn.disabled = true;
                }
            }
        }
    };

    dialogContinueBtn.onclick = () => {
        socket.emit("cropImgArgs", cropImgArgs);
        dialogContinueBtn.classList.add("loading");
        dialogContinueBtn.disabled = true;
        cropImgDialogImg.onpointerup = () => { };
        cropImgDialogImg.onclick = () => { };
        socket.on("getPath", (dataURL) => {
            getPath_dialog(dataURL);
        })
    }
}

function getPath_dialog(dataURL) {
    dialogContinueBtn.classList.remove("loading");
    dialogTitle.innerHTML = "Select path";
    dialogContinueBtn.disabled = true;
    dialogReadjustBtn.disabled = false;
    let getPathDialogImg = new Image();
    getPathDialogImg.id = "getPathDialogImg";
    getPathDialogImg.className = "resultDialogImg";
    getPathDialogImg.style.backgroundImage = "unset";
    let marginTop = (matchMedia("only screen and (max-width: 768px)").matches) ? "0px" : "4vw";
    getPathDialogImg.style.marginTop = "0vw";
    selectedColors = document.createElement("div");
    selectedColors.id = "selectedColors";
    dialogContent.replaceChildren(getPathDialogImg, selectedColors);

    let zoomContainer = enableZoom(getPathDialogImg, 2, 4);
    zoomContainer.style.marginTop = marginTop;

    getPathDialogImg.src = dataURL;
    getPathDialogImg.onload = () => {
        let canvas = document.createElement('canvas');
        canvas.width = getPathDialogImg.naturalWidth;
        canvas.height = getPathDialogImg.naturalHeight;
        let context = canvas.getContext("2d");
        context.drawImage(getPathDialogImg, 0, 0);

        let colors = [];
        getPathDialogImg.onclick = (e) => {
            let size = getObjectFitSize(true, getPathDialogImg.width, getPathDialogImg.height, getPathDialogImg.naturalWidth, getPathDialogImg.naturalHeight);

            let x = e.offsetX - Math.floor((getPathDialogImg.width - size.width) / 2);
            let y = e.offsetY - Math.floor((getPathDialogImg.height - size.height) / 2);
            if (
                ((0 < x) && (x < size.width)) && ((0 < y) && (y < size.height))
            ) {
                x = Math.floor((x / size.width) * getPathDialogImg.naturalWidth);
                y = Math.floor((y / size.height) * getPathDialogImg.naturalHeight);

                let data = context.getImageData(x, y, 1, 1).data;
                let rgb = `rgb(${data[0]}, ${data[1]}, ${data[2]})`;

                if (!colors.includes(rgb)) {
                    colors.push(rgb);
                    let color = document.createElement("div");
                    color.className = "color";
                    color.style.backgroundColor = rgb;
                    color.setAttribute("r", y);
                    color.setAttribute("c", x);
                    color.onclick = (e) => {
                        selectedColors.removeChild(e.target)
                        colors.splice(colors.indexOf(e.target.style.backgroundColor), 1);
                        if (selectedColors.children.length == 0) {
                            dialogContinueBtn.disabled = true;
                        }
                    };
                    selectedColors.appendChild(color);

                    dialogContinueBtn.disabled = false;
                }
            }
        }
    };

    dialogContinueBtn.onclick = () => {
        colors = [];
        let points = [];
        for (let color of selectedColors.children) {
            color.onclick = () => { };
            points.push([
                parseInt(color.getAttribute("r")),
                parseInt(color.getAttribute("c"))
            ]);
        }
        socket.emit("getPathArgs", { "points": points });
        dialogContinueBtn.classList.add("loading");
        dialogContinueBtn.disabled = true;
        dialogReadjustBtn.disabled = true;
        getPathDialogImg.onpointerup = () => { };
        getPathDialogImg.onclick = () => { };

        socket.on("cleanPath", (resultDataURL) => {
            dialogContent.replaceChildren(getPathDialogImg);
            getPathDialogImg.style.marginTop = marginTop;
            hideResultOverlay(getPathDialogImg);
            getPathDialogImg.src = resultDataURL;
            getPathDialogImg.onload = () => {
                dialogContinueBtn.classList.remove("loading");
                dialogContinueBtn.disabled = false;
                dialogReadjustBtn.disabled = false;
                dialogTitle.innerHTML = "Selected path";
                getPathDialogImg.onclick = () => {
                    toggleResultOverlay(getPathDialogImg);
                };

                dialogContinueBtn.onclick = () => {
                    cleanPath_dialog();
                }

                dialogReadjustBtn.onclick = () => {
                    getPath_dialog(dataURL);
                }
            }
        })
    }

    dialogReadjustBtn.onclick = () => {
        socket.emit("readjustCropImg", (dataURL) => {
            cropImg_dialog(dataURL);
        })
    }
}

function cleanPath_dialog() {
    dialogContinueBtn.classList.remove("loading");
    dialogTitle.innerHTML = "Choose threshold";
    dialogContinueBtn.disabled = false;
    dialogReadjustBtn.disabled = false;
    let cleanPathContent = document.createElement("div");
    cleanPathContent.id = "cleanPathContent";
    cleanPathContent.innerHTML = `
        <img id="cleanPathImg">
        <div id="cleanPathInputContainer">
            <div id="cleanPathText">Connected shapes whose diagonal length is below the threshold value are removed</div>
            <label for="cleanPathInput" id="cleanPathInputLabel">Threshold: </label>
            <input id="cleanPathInput" type="number" name="cleanPathInput" min="0" value="24" required>
        </div>
    `;
    dialogContent.replaceChildren(cleanPathContent);

    let cleanPathInput = document.getElementById("cleanPathInput");
    cleanPathInput.oninput = () => {
        if (cleanPathInput.checkValidity()) {
            dialogContinueBtn.disabled = false;
        } else {
            dialogContinueBtn.disabled = true;
        }
    }

    dialogContinueBtn.onclick = () => {
        socket.emit("cleanPathArgs", parseInt(cleanPathInput.value));
        dialogContinueBtn.classList.add("loading");
        dialogContinueBtn.disabled = true;
        dialogReadjustBtn.disabled = true;
        socket.on("closeGaps", (dataURL) => {
            let resultImg = new Image();
            resultImg.className = "resultDialogImg";
            dialogContent.replaceChildren(resultImg);
            hideResultOverlay(resultImg);
            resultImg.src = dataURL;
            resultImg.onload = () => {
                dialogContinueBtn.classList.remove("loading");
                dialogContinueBtn.disabled = false;
                dialogReadjustBtn.disabled = false;
                dialogTitle.innerHTML = "Resulting path";
                resultImg.onclick = () => { toggleResultOverlay(resultImg) };

                dialogContinueBtn.onclick = () => {
                    closeGaps_dialog();
                }

                dialogReadjustBtn.onclick = () => {
                    cleanPath_dialog();
                }
            }
        })
    }

    dialogReadjustBtn.onclick = () => {
        socket.emit("readjustGetPath", (dataURL) => {
            getPath_dialog(dataURL);
        })
    }
}

function closeGaps_dialog() {
    dialogContinueBtn.classList.remove("loading");
    dialogTitle.innerHTML = "Close gaps";
    dialogContinueBtn.disabled = false;
    dialogReadjustBtn.disabled = false;
    let closeGapsContent = document.createElement("div");
    closeGapsContent.id = "closeGapsContent";
    closeGapsContent.innerHTML = `
    <img id="closeGapsImg">
    <div id="closeGapsInputContainer">
        <label for="closeGapsPointsInput" class="closeGapsInputLabel">Chord points: </label>
        <input id="closeGapsPointsInput" class="closeGapsInput" type="number" name="closeGapsPointsInput" min="2" value="6" required>

        <label for="closeGapsLengthInput" class="closeGapsInputLabel">Maximum distance: </label>
        <input id="closeGapsLengthInput" class="closeGapsInput" type="number" name="closeGapsLengthInput" min="1" value="40" required>

        <label for="closeGapsSpreadInput" class="closeGapsInputLabel">Maximum angle: </label>
        <input id="closeGapsSpreadInput" class="closeGapsInput" type="number"name="closeGapsSpreadInput" min="0" max="180" value="30" required>
    </div>
    `;
    dialogContent.replaceChildren(closeGapsContent);

    validities = [true, true, true];
    let pointsInput = document.getElementById("closeGapsPointsInput");
    pointsInput.oninput = () => {
        validities[0] = pointsInput.checkValidity();
        if (validities.every((e) => e)) {
            dialogContinueBtn.disabled = false;
        } else {
            dialogContinueBtn.disabled = true;
        }
    }

    let lengthInput = document.getElementById("closeGapsLengthInput");
    lengthInput.oninput = () => {
        validities[1] = lengthInput.checkValidity();
        if (validities.every((e) => e)) {
            dialogContinueBtn.disabled = false;
        } else {
            dialogContinueBtn.disabled = true;
        }
    }

    let spreadInput = document.getElementById("closeGapsSpreadInput");
    spreadInput.oninput = () => {
        validities[2] = spreadInput.checkValidity();
        if (validities.every((e) => e)) {
            dialogContinueBtn.disabled = false;
        } else {
            dialogContinueBtn.disabled = true;
        }
    }

    dialogContinueBtn.onclick = () => {
        socket.emit("closeGapsArgs", {
            "chordPoints": parseInt(pointsInput.value),
            "maxDist": parseInt(lengthInput.value),
            "maxAngle": parseInt(spreadInput.value)
        });
        dialogContinueBtn.classList.add("loading");
        dialogContinueBtn.disabled = true;
        dialogReadjustBtn.disabled = true;
        socket.on("closeGapsResult", (dataURL) => {
            let resultImg = new Image();
            resultImg.className = "resultDialogImg";
            dialogContent.replaceChildren(resultImg);
            hideResultOverlay(resultImg);
            resultImg.src = dataURL;
            resultImg.onload = () => {
                dialogContinueBtn.classList.remove("loading");
                dialogContinueBtn.disabled = false;
                dialogReadjustBtn.disabled = false;
                dialogTitle.innerHTML = "Resulting path";
                resultImg.onclick = () => { toggleResultOverlay(resultImg) };

                dialogContinueBtn.onclick = () => {
                    socket.emit("getGraph");
                    dialogContinueBtn.disabled = true;
                    dialogReadjustBtn.disabled = true;
                    dialogContinueBtn.innerHTML = "Generating graph...";
                }

                dialogReadjustBtn.onclick = () => {
                    closeGaps_dialog();
                }
            }
        })
    }

    dialogReadjustBtn.onclick = () => {
        cleanPath_dialog();
    }
}

var routefinderGraphFunc = {
    getGraphFromPath: (pathImg) => {
        let shape = [pathImg.length, pathImg[0].length]

        let edges = [];
        let nodes = [];
        for (let r = 0; r < shape[0]; r++) {
            for (let c = 0; c < shape[1]; c++) {
                if (pathImg[r][c]) {
                    nodes.push([r, c]);

                    let neighbours = [
                        [r - 1, c - 1], [r - 1, c], [r - 1, c + 1],
                        [r, c - 1]
                    ];

                    neighbours.forEach((neighbour) => {
                        let [nr, nc] = neighbour;
                        if (pathImg[nr]) {
                            if (pathImg[nr][nc]) {
                                edges.push([[r, c], [nr, nc]]);
                            }
                        }
                    });

                }
            }
        }

        let graph = new graphology.Graph({ type: "undirected" });
        nodes.forEach((node) => graph.addNode(node));
        edges.forEach((edge) => graph.addEdge(...edge));

        return graph;
    },

    label: (img) => {
        let shape = [img.length, img[0].length];

        let labels = Array.from(
            new Array(shape[0]), () => new Array(shape[1]).fill(0)
        );
        let labelN = 1;

        for (let r = 0; r < shape[0]; r++) {
            for (let c = 0; c < shape[1]; c++) {
                if (img[r][c] && labels[r][c] == 0) {
                    labels[r][c] = labelN;

                    let queue = [[r, c]];
                    while (queue.length > 0) {
                        let [cr, cc] = queue.pop();
                        [
                            [cr - 1, cc - 1], [cr - 1, cc], [cr - 1, cc + 1],
                            [cr, cc - 1], [cr, cc], [cr, cc + 1],
                            [cr + 1, cc - 1], [cr + 1, cc], [cr + 1, cc + 1]
                        ].forEach(([nr, nc]) => {
                            if (
                                (nr >= 0 && nr < shape[0]) &&
                                (nc >= 0 && nc < shape[1]) &&
                                (img[nr][nc] && labels[nr][nc] == 0)
                            ) {
                                labels[nr][nc] = labelN;
                                queue.push([nr, nc]);
                            }
                        })
                    }

                    labelN++;
                }
            }
        }

        return labels
    },

    findRoute: (graph, labels, source, target) => {
        let pathPoints = graph.nodes().map(
            (node) => Object.fromEntries(node.split(",").map((n, i) => [["x", "y"][i], parseInt(n)]))
        );
        let distance = function (a, b) {
            return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
        }
        let tree = new kdTree(pathPoints, distance, ["x", "y"]);

        let start = tree.nearest({ x: source[0], y: source[1] }, 1)[0][0];
        let altStart = tree.nearest({ x: target[0], y: target[1] }, 1)[0][0];

        let start_pathPoints = pathPoints.filter(
            (p) => labels[p.x][p.y] === labels[start.x][start.y]
        );
        let altStart_pathPoints = pathPoints.filter(
            (p) => labels[p.x][p.y] === labels[altStart.x][altStart.y]
        );

        let start_tree = new kdTree(start_pathPoints, distance, ["x", "y"]);
        let altStart_tree = new kdTree(altStart_pathPoints, distance, ["x", "y"]);

        let end = start_tree.nearest({ x: target[0], y: target[1] }, 1)[0][0];
        let altEnd = altStart_tree.nearest({ x: source[0], y: source[1] }, 1)[0][0];

        let reversedTargets;
        if (distance(end, { x: target[0], y: target[1] }) <= distance(altEnd, { x: source[0], y: source[1] })) {
            source = [start.x, start.y];
            target = [end.x, end.y];
            reversedTargets = false;
        } else {
            source = [altStart.x, altStart.y];
            target = [altEnd.x, altEnd.y];
            reversedTargets = true;
        }

        let path;
        try {
            path = graphologyLibrary.shortestPath.bidirectional(graph, source, target);
        } catch (e) {
            console.log(e);
            path = null;
        }
        if (path !== null) {
            path = path.map(
                (node) => node.split(",").map((n) => parseInt(n))
            );
        }

        return [path, reversedTargets];
    }
};

var map, mapImg, graph, labels, pathMask;
socket.on("showNavigator", (pathImg) => {
    let mapDiv = document.createElement("div");
    mapDiv.id = "map"
    screen.replaceChildren(mapDiv);

    let [w, h] = [imgData.width, imgData.height];
    let [max_w, max_h] = [window.innerWidth, window.innerHeight];
    let zoom = Math.floor(Math.min(Math.log2(max_h / h), Math.log2(max_w / w)));
    zoom = (h > max_h || w > max_w) ? zoom : 0;

    map = L.map("map", { crs: L.CRS.Simple, minZoom: zoom });
    mapImg = L.imageOverlay(
        imgData.url, [[0, 0], [h, w]], { interactive: true }
    ).addTo(map);
    map.fitBounds([[0, 0], [h, w]]);

    map.zoomControl.setPosition('topright');
    getNavigator({ position: "topleft" }).addTo(map);
    getSaveBtn({ position: "bottomleft" }).addTo(map);

    mapImg.on("click", ({ latlng }) => placeMarker(latlng));

    pathMask = pathImg;
    labels = routefinderGraphFunc.label(pathImg);
    graph = routefinderGraphFunc.getGraphFromPath(pathImg);
    let graphPoints = [...graph.edgeEntries()].map(({ source, target }) => {
        source = source.split(",").map((n) => parseInt(n));
        target = target.split(",").map((n) => parseInt(n));
        return [[imgData.height - source[0], source[1]],
        [imgData.height - target[0], target[1]]];
    });
    L.polyline(graphPoints,
        { color: "#000", opacity: 0.1, smoothFactor: 4, interactive: false }
    ).addTo(map);
});

function getSaveBtn(options) {
    L.Control.SaveBtn = L.Control.extend({
        onAdd: function (map) {
            let save = L.DomUtil.create("div", "leaflet-bar");
            save.id = "save"

            saveBtn = L.DomUtil.create("img", "navigatorBtn");
            saveBtn.id = "saveBtn";
            saveBtn.src = "static/save.svg";
            L.DomEvent.on(saveBtn, "click", saveFile);

            save.replaceChildren(saveBtn);

            return save;
        },

        onRemove: () => { }
    })

    return new L.Control.SaveBtn(options);
}

function saveFile() {
    let file = new Blob([JSON.stringify({
        "img": imgData.url,
        "path_mask": pathMask
    })], { type: "application/json" });

    let url = URL.createObjectURL(file)
    let link = document.createElement("a");
    link.href = url;
    link.download = "untitled.routefinder";
    link.click();
    URL.revokeObjectURL(url);
}

var setStart = false;
var setEnd = false;
var markerBtnsDisabled = false;
var navigateBtn, startMarkerBtn, endMarkerBtn;
function getNavigator(options) {
    L.Control.Navigator = L.Control.extend({
        onAdd: function (map) {
            let navigator = L.DomUtil.create("div", "leaflet-bar");
            navigator.id = "navigator";

            resetBtn = L.DomUtil.create("img", "navigatorBtn");
            resetBtn.id = "resetBtn";
            resetBtn.src = "static/reset.svg";
            L.DomEvent.on(resetBtn, "click", reset);

            startMarkerBtn = L.DomUtil.create("img", "navigatorBtn");
            startMarkerBtn.id = "startMarkerBtn"
            startMarkerBtn.src = "static/unset_start_marker.svg";
            L.DomEvent.on(startMarkerBtn, "click", () => {
                if (!markerBtnsDisabled) {
                    if (setStart) {
                        setStart = false;
                        L.DomUtil.removeClass(mapImg.getElement(), "startMarkerCursor");
                        if (startMarker) {
                            startMarkerBtn.src = "static/set_start_marker.svg";
                        } else {
                            startMarkerBtn.src = "static/unset_start_marker.svg";
                        }
                    } else {
                        setStart = true;
                        setEnd = false;
                        L.DomUtil.setClass(mapImg.getElement(), "startMarkerCursor");
                        startMarkerBtn.src = "static/edit_start_marker.svg";
                        if (endMarker) {
                            endMarkerBtn.src = "static/set_end_marker.svg";
                        } else {
                            endMarkerBtn.src = "static/unset_end_marker.svg";
                        }
                    }
                }
            })

            endMarkerBtn = L.DomUtil.create("img", "navigatorBtn");
            endMarkerBtn.id = "endMarkerBtn";
            endMarkerBtn.src = "static/unset_end_marker.svg";
            L.DomEvent.on(endMarkerBtn, "click", () => {
                if (!markerBtnsDisabled) {
                    if (setEnd) {
                        setEnd = false;
                        L.DomUtil.removeClass(mapImg.getElement(), "endMarkerCursor");
                        if (endMarker) {
                            endMarkerBtn.src = "static/set_end_marker.svg";
                        } else {
                            endMarkerBtn.src = "static/unset_end_marker.svg";
                        }
                    } else {
                        setStart = false;
                        setEnd = true;
                        L.DomUtil.setClass(mapImg.getElement(), "endMarkerCursor");
                        endMarkerBtn.src = "static/edit_end_marker.svg";
                        if (startMarker) {
                            startMarkerBtn.src = "static/set_start_marker.svg";
                        } else {
                            startMarkerBtn.src = "static/unset_start_marker.svg";
                        }
                    }
                }
            })

            navigateBtn = L.DomUtil.create("img", "navigatorBtn disabled");
            navigateBtn.id = "navigateBtn";
            navigateBtn.src = "static/navigate.svg";

            navigator.replaceChildren(resetBtn, startMarkerBtn, endMarkerBtn, navigateBtn);

            return navigator;
        },

        onRemove: () => { }
    })

    return new L.Control.Navigator(options);
}

var startMarker, endMarker;
function placeMarker(latlng) {
    if (setStart) {
        if (startMarker) {
            startMarker.setLatLng(latlng)
        } else {
            let icon = L.icon({
                iconUrl: "static/start_marker.svg",
                iconSize: [24, 24],
                iconAnchor: [12, 21]
            })
            startMarker = L.marker(latlng, { icon: icon, interactive: false }).addTo(map);
        }
    }
    if (setEnd) {
        if (endMarker) {
            endMarker.setLatLng(latlng)
        } else {
            let icon = L.icon({
                iconUrl: "static/end_marker.svg",
                iconSize: [24, 24],
                iconAnchor: [12, 21]
            })
            endMarker = L.marker(latlng, { icon: icon, interactive: false }).addTo(map);
        }
    }

    if (startMarker && endMarker) {
        L.DomUtil.removeClass(navigateBtn, "disabled");
        L.DomEvent.on(navigateBtn, "click", () => {
            L.DomUtil.addClass(navigateBtn, "disabled");
            L.DomEvent.off(navigateBtn, "click");
            startMarkerBtn.src = "static/set_start_marker.svg";
            endMarkerBtn.src = "static/set_end_marker.svg";
            L.DomUtil.addClass(startMarkerBtn, "disabled");
            L.DomUtil.addClass(endMarkerBtn, "disabled");
            markerBtnsDisabled = true;
            setStart = false;
            setEnd = false;
            L.DomUtil.setClass(mapImg.getElement(), "");
            mapImg.off("click");

            findRoute();
        });
    }
}

var startPos, endPos;
function findRoute() {
    startPos = startMarker.getLatLng();
    endPos = endMarker.getLatLng();
    startPos = [
        Math.round(imgData.height - startPos.lat),
        Math.round(startPos.lng)
    ];
    endPos = [
        Math.round(imgData.height - endPos.lat),
        Math.round(endPos.lng)
    ];

    displayRoute(
        routefinderGraphFunc.findRoute(graph, labels, startPos, endPos)
    );
}

var path, path_ext;
function displayRoute([route, reversed]) {
    route = route.map((yx) => [imgData.height - yx[0], yx[1]]);

    if (!path) {
        path = L.polyline([], { color: "#50597a", smoothFactor: 4 }).addTo(map);
        path_ext = L.polyline([], { color: "#50597a", dashArray: "1 10" }).addTo(map);
    }

    path.setLatLngs(route);
    path_ext.setLatLngs(
        [[startMarker.getLatLng(), (reversed) ? route.at(-1) : route[0]],
        [endMarker.getLatLng(), (reversed) ? route[0] : route.at(-1)]]
    );
}

function reset() {
    mapImg.on("click", ({ latlng }) => placeMarker(latlng));
    L.DomUtil.addClass(navigateBtn, "disabled");
    L.DomEvent.off(navigateBtn, "click");
    startMarkerBtn.src = "static/unset_start_marker.svg";
    endMarkerBtn.src = "static/unset_end_marker.svg";
    L.DomUtil.removeClass(startMarkerBtn, "disabled");
    L.DomUtil.removeClass(endMarkerBtn, "disabled");
    markerBtnsDisabled = false;
    setStart = false;
    setEnd = false;
    L.DomUtil.setClass(mapImg.getElement(), "");
    if (startMarker) { startMarker.remove(); startMarker = undefined; }
    if (endMarker) { endMarker.remove(); endMarker = undefined; }
    if (path) {
        path.setLatLngs([]);
        path_ext.setLatLngs([]);
    }
}