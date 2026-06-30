/* exported Editor */
const Editor = (() => {
  let active = false;
  let currentImgWrap = null;
  const fileInput = document.getElementById('img-file-input');

  async function enter() {
    active = true;
    document.body.classList.add('edit-mode');
    document.getElementById('edit-bar').classList.add('visible');
    if (typeof setEditButtonText === 'function') setEditButtonText('✕ Quitter');
    document.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'true'));
    document.querySelector('nav').style.top = '44px';
    // Si pas de V0, capture l'état HTML de base
    const check = await fetch('/api/content/base', { headers: Auth.authHeaders() });
    const { exists } = await check.json();
    if (!exists) await saveInitialVersion();
    loadContent();
  }

  async function saveInitialVersion() {
    const snapshot = {};
    document.querySelectorAll('[contenteditable]').forEach((el, i) => {
      snapshot['el_' + i] = el.innerHTML;
    });
    document.querySelectorAll('img').forEach((img, i) => {
      snapshot['img_' + i] = img.src;
    });
    await fetch('/api/content', {
      method: 'POST',
      headers: Auth.authHeaders(),
      body: JSON.stringify({ snapshot, isBase: true })
    });
  }

  function exit() {
    active = false;
    document.body.classList.remove('edit-mode');
    document.getElementById('edit-bar').classList.remove('visible');
    if (typeof setEditButtonText === 'function') setEditButtonText('✎ Éditer');
    document.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'false'));
    document.querySelector('nav').style.top = '';
    loadContent();
  }

  function isActive() { return active; }

  async function save() {
    const snapshot = {};
    document.querySelectorAll('[contenteditable]').forEach((el, i) => {
      snapshot['el_' + i] = el.innerHTML;
    });
    document.querySelectorAll('img').forEach((img, i) => {
      if (img.dataset.replaced) snapshot['img_' + i] = img.src;
    });

    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: Auth.authHeaders(),
        body: JSON.stringify({ snapshot })
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
      document.querySelectorAll('[contenteditable]').forEach((el, i) => {
        if (snapshot['el_' + i] !== undefined) el.innerHTML = snapshot['el_' + i];
      });
      document.querySelectorAll('img').forEach((img, i) => {
        if (snapshot['img_' + i]) { img.src = snapshot['img_' + i]; img.dataset.replaced = '1'; }
      });
    } catch {}
  }

  async function toggleHistory() {
    const dropdown = document.getElementById('history-dropdown');
    if (dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
      return;
    }
    dropdown.innerHTML = '<div class="history-loading">Chargement…</div>';
    dropdown.style.display = 'block';

    try {
      const res = await fetch('/api/content/history', { headers: Auth.authHeaders() });
      const versions = await res.json();
      if (!versions.length) {
        dropdown.innerHTML = '<div class="history-empty">Aucune version sauvegardée</div>';
        return;
      }
      dropdown.innerHTML = versions.map((v, i) => {
        const date = new Date(v.saved_at + 'Z');
        const label = i === 0 ? ' (dernière)' : '';
        const formatted = date.toLocaleDateString('fr-FR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
        return `<button class="history-item" onclick="Editor.restoreVersion(${v.id})">
          <span class="history-num">V${versions.length - i}</span>
          <span class="history-date">${formatted}${label}</span>
        </button>`;
      }).join('');
    } catch {
      dropdown.innerHTML = '<div class="history-empty">Erreur de chargement</div>';
    }
  }

  async function restoreVersion(id) {
    document.getElementById('history-dropdown').style.display = 'none';
    try {
      const res = await fetch(`/api/content/${id}`, { headers: Auth.authHeaders() });
      const { snapshot } = await res.json();
      if (!snapshot) return;
      document.querySelectorAll('[contenteditable]').forEach((el, i) => {
        if (snapshot['el_' + i] !== undefined) el.innerHTML = snapshot['el_' + i];
      });
      document.querySelectorAll('img').forEach((img, i) => {
        if (snapshot['img_' + i]) { img.src = snapshot['img_' + i]; img.dataset.replaced = '1'; }
      });
      const span = document.querySelector('#edit-bar > span');
      const orig = span.textContent;
      span.textContent = '↩ Version restaurée — pensez à enregistrer';
      setTimeout(() => { span.textContent = orig; }, 3000);
    } catch {
      alert('Erreur lors de la restauration.');
    }
  }

  function replaceImage(wrap) {
    if (!active) return;
    currentImgWrap = wrap;
    fileInput.click();
  }

  fileInput.addEventListener('change', function () {
    if (!this.files?.[0] || !currentImgWrap) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = currentImgWrap.querySelector('img');
      if (img) {
        img.src = e.target.result;
        img.dataset.replaced = '1';
      } else {
        currentImgWrap.style.backgroundImage = `url(${e.target.result})`;
        currentImgWrap.style.backgroundSize = 'cover';
        currentImgWrap.style.backgroundPosition = 'center';
      }
    };
    reader.readAsDataURL(this.files[0]);
    this.value = '';
  });

  return { enter, exit, isActive, save, loadContent, replaceImage, toggleHistory, restoreVersion };
})();

window.replaceImage = Editor.replaceImage.bind(Editor);
