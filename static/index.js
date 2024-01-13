// Title
let screen = document.getElementById("screen");
fetch("static/RouteFinder.svg").then((res) => res.text()).then(
    (svgString) => {
        let doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
        let svg = doc.getElementsByTagName("svg")[0];

        svg.id = "title";

        screen.insertBefore(svg, screen.firstChild);

        Array.from(
            document.getElementsByClassName("AnimationOffset")
        ).forEach(
            (s) => {
                s.attributes.dur.value = "0.6s";
            }
        );
    }
)


// Input
fileInput = document.getElementById("fileInput");
fileInputBtn = document.getElementById("fileInputBtn");
startBtn = document.getElementById("startBtn");

if (fileInput.files.length > 0) {
    fileInput.value = '';
    startBtn.disabled = true;
}
fileInput.onchange = () => {
    if (fileInput.files.length > 0) {
        fileInputBtn.innerHTML = fileInput.files[0].name;

        startBtn.disabled = false;
    }
}