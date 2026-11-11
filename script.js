const form = document.getElementById("downloadForm");
const input = document.getElementById("tiktokUrl");
const message = document.getElementById("message");
const preview = document.getElementById("preview");
const player = document.getElementById("videoPlayer");
const downloadBtn = document.getElementById("downloadBtn");
const videoTitle = document.getElementById("videoTitle");
const submitBtn = document.getElementById("submitBtn");
const pasteBtn = document.getElementById("pasteBtn");

function showMessage(text, type = "info") {
  message.textContent = text;
  message.className = type;
}

function isTikTokUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      (parsed.hostname === "tiktok.com" || parsed.hostname.endsWith(".tiktok.com"));
  } catch {
    return false;
  }
}

function resetPreview() {
  player.pause();
  player.removeAttribute("src");
  player.load();
  preview.hidden = true;
  downloadBtn.hidden = true;
  downloadBtn.removeAttribute("href");
  videoTitle.textContent = "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = input.value.trim();

  if (!isTikTokUrl(url)) {
    resetPreview();
    showMessage("Masukkan link TikTok yang valid (diawali https://).", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Memproses...";
  resetPreview();
  showMessage("Sedang mengambil video. Tunggu sebentar...", "info");

  try {
    const response = await fetch(`/api/video?url=${encodeURIComponent(url)}`);
    const result = await response.json();

    if (!response.ok || !result.success || !result.videoUrl) {
      throw new Error(result.error || "Video tidak berhasil diambil.");
    }

    // Gunakan proxy server agar preview dan pengunduhan tidak bergantung
    // pada atribut download lintas-domain yang sering diabaikan browser.
    const mediaUrl = `/api/download?url=${encodeURIComponent(result.videoUrl)}`;
    player.src = mediaUrl;
    if (result.cover) player.poster = result.cover;
    videoTitle.textContent = result.title || "Video TikTok";
    downloadBtn.href = mediaUrl;
    downloadBtn.hidden = false;
    preview.hidden = false;
    player.load();
    showMessage("Video berhasil ditemukan. Tekan tombol play atau Download Video.", "success");
  } catch (error) {
    showMessage(error.message || "Terjadi kesalahan saat mengambil video.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Unduh";
  }
});

pasteBtn.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      throw new Error("Clipboard tidak tersedia. Tekan lama kolom link lalu pilih Tempel.");
    }
    const text = await navigator.clipboard.readText();
    if (text) input.value = text.trim();
    else showMessage("Clipboard kosong.", "error");
  } catch (error) {
    showMessage(error.message || "Tidak bisa membaca clipboard. Tempel link secara manual.", "error");
  }
});

player.addEventListener("error", () => {
  if (!preview.hidden) {
    showMessage("Video gagal diputar. Coba lagi atau gunakan link video publik lain.", "error");
  }
});
