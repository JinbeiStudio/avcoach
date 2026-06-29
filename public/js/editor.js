const Editor = (() => {
  let active = false;
  let currentImgWrap = null;
  const fileInput = document.getElementById('img-file-input');

  function enter() {
    active = true;
    document.body.classList.add('edit-mode');
    document.getElementById('edit-bar').classList.add('visible');
    document.getElementById('editToggle').textContent = '✕ Fermer';
    document.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'true'));
    document.querySelector('nav').style.top = '44px';
    loadContent();
  }

  function exit() {
    active = false;
    document.body.classList.remove('edit-mode');
    document.getElementById('edit-bar').classList.remove('visible');
    document.getElementById('editToggle').textContent = '✎ Éditer';
    document.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'false'));
    document.querySelector('nav').style.top = '';
  }

  function isActive() { return active; }

  async function save() {
    const snapshot = {};
    document.querySelectorAll('[contenteditable]').forEach((el, i) => {
      snapshot['el_' + i] = el.innerHTML;
    });
    document.querySelectorAll('img[data-replaced]').forEach((img, i) => {
      snapshot['img_' + i] = img.src;
    });

    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: Auth.authHeaders(),
        body: JSON.stringify({ snapshot })
      });
      if (!res.ok) throw new Error();
      showSaveConfirm();
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

  function showSaveConfirm() {
    const bar = document.getElementById('edit-bar');
    const span = bar.querySelector('span');
    const orig = span.textContent;
    span.textContent = '✓ Contenu sauvegardé avec succès !';
    setTimeout(() => { span.textContent = orig; }, 2500);
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
      let img = currentImgWrap.querySelector('img');
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

  return { enter, exit, isActive, save, loadContent, replaceImage };
})();

window.replaceImage = Editor.replaceImage.bind(Editor);
