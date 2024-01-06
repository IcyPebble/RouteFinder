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