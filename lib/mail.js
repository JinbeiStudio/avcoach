const nodemailer = require('nodemailer');
const { getDb } = require('../database/db');

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mail.me.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Envoie les identifiants des comptes créés au démarrage ; en cas d'échec, les journalise pour ne pas bloquer l'accès
function sendWelcomeEmails(newUsers) {
  if (!newUsers.length) return Promise.resolve();
  const transporter = createTransporter();
  return Promise.all(
    newUsers.map(({ username, email, tempPassword }) =>
      transporter
        .sendMail({
          from: `"AV Coach" <${process.env.SMTP_USER}>`,
          to: email,
          subject: `Bienvenue sur AVCoach — vos identifiants`,
          text: `Bonjour,\n\nVotre compte AVCoach a été créé.\n\nIdentifiant : ${username}\nMot de passe temporaire : ${tempPassword}\n\nConnectez-vous sur le site et définissez votre mot de passe définitif.\n\nCe mot de passe temporaire ne sera plus valable une fois changé.`,
          html: `<p>Bonjour,</p><p>Votre compte AVCoach a été créé.</p><table><tr><td><strong>Identifiant</strong></td><td>${escapeHtml(username)}</td></tr><tr><td><strong>Mot de passe temporaire</strong></td><td><code>${escapeHtml(tempPassword)}</code></td></tr></table><p>Connectez-vous sur le site et définissez votre mot de passe définitif.</p>`
        })
        .then(() => {
          getDb().prepare('UPDATE users SET welcome_email_sent = 1 WHERE username = ?').run(username);
          console.log(`✓ Email de bienvenue envoyé à ${email} (${username})`);
        })
        .catch((err) => {
          console.error(`✗ Échec envoi email ${username} :`, err.message);
          console.warn(
            `⚠ Mot de passe temporaire de ${username} : ${tempPassword} — à changer dès la première connexion.`
          );
        })
    )
  );
}

module.exports = { createTransporter, escapeHtml, sendWelcomeEmails };
