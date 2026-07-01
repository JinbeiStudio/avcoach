/* exported Editor */
const Editor = (() => {
  let active = false;
  let currentImgWrap = null;
  let baseline = {};
  const fileInput = document.getElementById('img-file-input');

  function captureSnapshot() {
    const snapshot = {};
    document.querySelectorAll('[contenteditable]').forEach((el) => {
      if (el.dataset.editId) snapshot['el_' + el.dataset.editId] = el.innerHTML;
    });
    document.querySelectorAll('img').forEach((img) => {
      if (img.dataset.editId) snapshot['img_' + img.dataset.editId] = img.src;
    });
    return snapshot;
  }

  async function enter() {
    active = true;
    document.body.classList.add('edit-mode');
    document.getElementById('edit-bar').classList.add('visible');
    if (typeof setEditButtonText === 'function') setEditButtonText('✕ Quitter');
    document.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'true'));
    document.querySelector('nav').style.top = '44px';
    // Si pas de V0, capture l'état HTML de base
    const check = await fetch('/api/content/base', { headers: Auth.authHeaders() });
    const { exists } = await check.json();
    if (!exists) await saveInitialVersion();
    await loadContent();
    // Référence pour ne détecter/envoyer que les champs réellement modifiés
    baseline = captureSnapshot();
  }

  async function saveInitialVersion() {
    await fetch('/api/content', {
      method: 'POST',
      headers: Auth.authHeaders(),
      body: JSON.stringify({ snapshot: captureSnapshot(), isBase: true })
    });
  }

  function exit() {
    active = false;
    document.body.classList.remove('edit-mode');
    document.getElementById('edit-bar').classList.remove('visible');
    if (typeof setEditButtonText === 'function') setEditButtonText('✎ Éditer');
    document.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'));
    document.querySelector('nav').style.top = '';
    loadContent();
  }

  function isActive() {
    return active;
  }

  async function save() {
    const current = captureSnapshot();
    const delta = {};
    for (const [key, value] of Object.entries(current)) {
      if (baseline[key] !== value) delta[key] = value;
    }

    if (!Object.keys(delta).length) {
      exit();
      return;
    }

    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: Auth.authHeaders(),
        body: JSON.stringify({ snapshot: delta })
      });
      if (!res.ok) throw new Error();
      exit();
    } catch {
      alert('Erreur lors de la sauvegarde. Vérifiez votre connexion.');
    }
  }

  async function loadContent() {
    try {
      const res = await fetch('/api/content/latest');
      const { snapshot } = await res.json();
      if (!snapshot) return;
      document.querySelectorAll('[contenteditable]').forEach((el) => {
        const key = 'el_' + el.dataset.editId;
        if (el.dataset.editId && snapshot[key] !== undefined) el.innerHTML = snapshot[key];
      });
      document.querySelectorAll('img').forEach((img) => {
        const key = 'img_' + img.dataset.editId;
        if (img.dataset.editId && snapshot[key]) img.src = snapshot[key];
      });
    } catch {}
  }

  function replaceImage(wrap) {
    if (!active) return;
    currentImgWrap = wrap;
    fileInput.click();
  }

  fileInput.addEventListener('change', function () {
    if (!this.files?.[0] || !currentImgWrap) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = currentImgWrap.querySelector('img');
      if (img) {
        img.src = e.target.result;
      } else {
        currentImgWrap.style.backgroundImage = `url(${e.target.result})`;
        currentImgWrap.style.backgroundSize = 'cover';
        currentImgWrap.style.backgroundPosition = 'center';
      }
    };
    reader.readAsDataURL(this.files[0]);
    this.value = '';
  });

  return { enter, exit, isActive, save, loadContent, replaceImage };
})();

window.replaceImage = Editor.replaceImage.bind(Editor);
