import nodemailer from "nodemailer";

// SMTP Configuration
const SMTP_USER = process.env.SMTP_USER || "emballage.raies@gmail.com";
const SMTP_PASS = process.env.SMTP_PASS || ""; // Ton app password Gmail

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

export async function sendResetCodeEmail(to: string, code: string) {
  const ADMIN_URL = process.env.APP_URL || "http://localhost:5173";

  const mailOptions = {
    from: `"SRED Admin" <${SMTP_USER}>`,
    to,
    subject: "Code de réinitialisation - SRED",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; background-color: #f0f7ff; margin: 0; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 3px solid #0056b3; overflow: hidden;">
            <div style="background-color: #0056b3; padding: 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 40px; color: #ffffff; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.2);">SRED</h1>
              <div style="color: #ffffff; font-size: 20px; font-weight: bold; margin-top: 5px;">RÉINITIALISATION</div>
            </div>
            <div style="padding: 40px 30px; background-color: #ffffff; color: #333333;">
              <h2 style="color: #0056b3; margin-top: 0; font-size: 24px;">Bonjour,</h2>
              <p style="font-size: 16px; line-height: 1.5;">Vous avez demandé un code de réinitialisation pour votre compte SRED.</p>
              
              <div style="background-color: #e6f2ff; border: 2px solid #0056b3; border-radius: 8px; padding: 25px; margin: 25px 0; text-align: center;">
                <div style="font-size: 14px; color: #0056b3; font-weight: bold; text-transform: uppercase;">Votre code (10 min)</div>
                <div style="font-size: 48px; font-weight: 900; color: #0056b3; letter-spacing: 5px; margin: 15px 0;">${code}</div>
              </div>

              <div style="text-align: center; margin-top: 30px;">
                <a href="${ADMIN_URL}/admin" style="display: inline-block; background-color: #0056b3; color: white; padding: 12px 25px; border-radius: 6px; text-decoration: none; font-weight: bold;">Retour à l'Administration</a>
              </div>

              <p style="font-size: 14px; color: #64748b; font-style: italic; margin-top: 30px; border-left: 3px solid #cbd5e1; padding-left: 15px;">
                Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité. Votre mot de passe actuel restera inchangé.
              </p>
            </div>
            <div style="text-align: center; padding: 30px; background: #f8fafc; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-weight: 600;">© ${new Date().getFullYear()} SRED - Emballages et Décors</p>
              <p style="margin-top: 5px; opacity: 0.8;">Ceci est un message automatique, veuillez ne pas y répondre.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email envoyé avec succès: %s", info.messageId);
    return true;
  } catch (error: any) {
    console.error("Erreur critique lors de l'envoi de l'email:", error.message);
    if (error.code === 'EAUTH') {
      console.error("ÉCHEC D'AUTHENTIFICATION: Vérifiez vos identifiants SMTP dans le fichier .env");
    }
    return false;
  }
}

export async function sendPasswordResetLinkEmail(to: string, token: string, code: string) {
  const APP_URL = process.env.APP_URL || "http://localhost:5173";
  const resetLink = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

  const mailOptions = {
    from: `"SRED Admin" <${SMTP_USER}>`,
    to,
    subject: "Réinitialisation du mot de passe - SRED",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; background-color: #f0f7ff; margin: 0; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 3px solid #0056b3; overflow: hidden;">
            <div style="background-color: #0056b3; padding: 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 40px; color: #ffffff; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.2);">SRED</h1>
              <div style="color: #ffffff; font-size: 20px; font-weight: bold; margin-top: 5px;">RÉINITIALISATION</div>
            </div>
            <div style="padding: 40px 30px; background-color: #ffffff; color: #333333;">
              <h2 style="color: #0056b3; margin-top: 0; font-size: 24px;">Bonjour,</h2>
              <p style="font-size: 16px; line-height: 1.5;">Vous avez demandé la réinitialisation de votre mot de passe SRED.</p>

              <div style="background-color: #e6f2ff; border: 2px solid #0056b3; border-radius: 8px; padding: 25px; margin: 25px 0; text-align: center;">
                <div style="font-size: 14px; color: #0056b3; font-weight: bold; text-transform: uppercase;">Code de vérification</div>
                <div style="font-size: 36px; font-weight: 900; color: #0056b3; letter-spacing: 3px; margin: 15px 0;">${code}</div>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetLink}" style="display: inline-block; background-color: #0056b3; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Changer mon mot de passe</a>
              </div>

              <p style="font-size: 14px; line-height: 1.6; color: #475569;">
                Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br>
                <a href="${resetLink}" style="color: #0056b3; word-break: break-all;">${resetLink}</a>
              </p>

              <p style="font-size: 14px; color: #64748b; font-style: italic; margin-top: 30px; border-left: 3px solid #cbd5e1; padding-left: 15px;">
                Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email. Votre mot de passe actuel restera inchangé.
              </p>
            </div>
            <div style="text-align: center; padding: 30px; background: #f8fafc; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-weight: 600;">© ${new Date().getFullYear()} SRED - Emballages et Décors</p>
              <p style="margin-top: 5px; opacity: 0.8;">Ceci est un message automatique, veuillez ne pas y répondre.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email envoyé avec succès: %s", info.messageId);
    return true;
  } catch (error: any) {
    console.error("Erreur critique lors de l'envoi du reset email:", error.message);
    if (error.code === 'EAUTH') {
      console.error("ÉCHEC D'AUTHENTIFICATION: Vérifiez vos identifiants SMTP dans le fichier .env");
    }
    return false;
  }
}

export async function sendWelcomeEmail(to: string, username: string) {
  const ADMIN_URL = process.env.APP_URL || "http://localhost:5173";
  const mailOptions = {
    from: `"SRED Admin" <${SMTP_USER}>`,
    to,
    subject: "Bienvenue chez SRED - Votre compte est prêt !",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; background-color: #f0f7ff; margin: 0; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 3px solid #0056b3; overflow: hidden;">
            <div style="background-color: #0056b3; padding: 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 40px; color: #ffffff; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.2);">SRED</h1>
              <div style="color: #ffffff; font-size: 20px; font-weight: bold; margin-top: 5px;">BIENVENUE</div>
            </div>
            <div style="padding: 40px 30px; background-color: #ffffff; color: #333333;">
              <h2 style="color: #0056b3; margin-top: 0; font-size: 24px;">Félicitations ${username} !</h2>
              <p style="font-size: 16px; line-height: 1.5;">Votre compte d'administration SRED a été créé avec succès par un Super Admin.</p>
              
              <div style="background-color: #f0f7ff; border-radius: 8px; padding: 25px; margin: 25px 0; border-left: 5px solid #0056b3;">
                <p style="margin: 0; font-size: 16px; color: #0056b3; font-weight: bold;">Identifiant : ${username}</p>
                <p style="margin: 10px 0 0; font-size: 14px; color: #555;">Vous pouvez maintenant vous connecter pour gérer vos produits, messages et promotions.</p>
              </div>

              <div style="text-align: center; margin-top: 30px;">
                <a href="${ADMIN_URL}/admin" style="display: inline-block; background-color: #0056b3; color: white; padding: 12px 25px; border-radius: 6px; text-decoration: none; font-weight: bold;">Se connecter au Dashboard</a>
              </div>

              <p style="font-size: 14px; color: #666; margin-top: 30px;">
                Nous sommes ravis de vous compter parmi nous !
              </p>
            </div>
            <div style="text-align: center; padding: 25px; background: #f8fafc; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-weight: 600;">© ${new Date().getFullYear()} SRED - Emballages et Décors</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Welcome Email envoyé avec succès: %s", info.messageId);
    return true;
  } catch (error: any) {
    console.error("Erreur lors de l'envoi du welcome email:", error.message);
    return false;
  }
}

export async function sendRejectionEmail(to: string, clientName: string) {
  const CONTACT_URL = process.env.APP_URL || "http://localhost:5173";
  const mailOptions = {
    from: `"SRED - Emballages & Décors" <${SMTP_USER}>`,
    to,
    subject: "Suivi de votre demande - SRED",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; background-color: #f0f7ff; margin: 0; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
            <div style="background-color: #0056b3; padding: 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 26px; color: #ffffff; font-weight: 700; letter-spacing: 4px;">SRED</h1>
              <div style="color: #ffffff; font-size: 13px; font-weight: 600; letter-spacing: 1.5px; margin-top: 8px; opacity: 0.9;">SUIVI DE COMMANDE</div>
            </div>
            <div style="padding: 40px 30px; background-color: #ffffff; color: #333333;">
              <h2 style="color: #0056b3; margin-top: 0; font-size: 22px;">Bonjour ${clientName},</h2>

              <p style="font-size: 16px; line-height: 1.6; color: #555;">
                Nous vous remercions de l'intérêt que vous portez à SRED.
              </p>

              <div style="background-color: #f8fafc; border-left: 4px solid #0056b3; border-radius: 4px; padding: 20px 25px; margin: 25px 0;">
                <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #334155;">
                  Après examen attentif de votre demande, nous ne sommes malheureusement pas en mesure d'y donner suite pour le moment.
                </p>
              </div>

              <p style="font-size: 16px; line-height: 1.6; color: #555;">
                Nous vous invitons à nous recontacter ultérieurement ou à nous rendre visite pour
                découvrir nos dernières offres et produits qui pourraient correspondre à vos attentes.
              </p>

              <div style="text-align: center; margin-top: 30px;">
                <a href="${CONTACT_URL}/contact" style="display: inline-block; background-color: #0056b3; color: white; padding: 12px 25px; border-radius: 6px; text-decoration: none; font-weight: bold;">Nous Contacter</a>
              </div>

              <p style="font-size: 14px; color: #64748b; margin-top: 30px; border-left: 3px solid #cbd5e1; padding-left: 15px;">
                Nous restons à votre disposition pour toute information complémentaire.
                L'équipe SRED vous souhaite une excellente journée.
              </p>
            </div>
            <div style="text-align: center; padding: 30px; background: #f8fafc; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-weight: 600;">© ${new Date().getFullYear()} SRED - Emballages et Décors</p>
              <p style="margin-top: 5px; opacity: 0.8;">Rue de la Liberté, 4000 Sousse, Tunisie</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email de rejet envoyé avec succès à %s: %s", to, info.messageId);
    return true;
  } catch (error: any) {
    console.error("Erreur lors de l'envoi de l'email de rejet à", to, ":", error.message);
    return false;
  }
}

/**
 * Génère le HTML sobre et professionnel pour une alerte de stock.
 * Design minimal : une seule couleur d'accent, pas d'ombres, pas de dégradés,
 * mise en page en table pour une compatibilité maximale avec les clients mail.
 */
function buildStockAlertHtml(
  productName: string,
  category: string,
  quantity: number,
  threshold: number,
  adminUrl: string
) {
  const isOutOfStock = quantity === 0;
  const accent = isOutOfStock ? "#b91c1c" : "#b45309";
  const statusLabel = isOutOfStock ? "Rupture de stock" : "Stock faible";
  const message = isOutOfStock
    ? "Ce produit n'est plus disponible à la vente. Un réapprovisionnement est nécessaire dès que possible."
    : `La quantité restante est inférieure au seuil défini (${threshold} unités). Pensez à planifier un réapprovisionnement.`;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${statusLabel}</title>
      </head>
      <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Arial, Helvetica, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 24px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border:1px solid #e2e2e2;">

                <!-- En-tête -->
                <tr>
                  <td style="padding: 20px 28px; border-bottom: 1px solid #e2e2e2;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 15px; font-weight: bold; color: #1f2937; letter-spacing: 1px;">SRED</td>
                        <td align="right" style="font-size: 12px; color: ${accent}; font-weight: bold; text-transform: uppercase;">${statusLabel}</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Corps -->
                <tr>
                  <td style="padding: 28px;">
                    <p style="margin: 0 0 16px; font-size: 14px; color: #374151; line-height: 1.6;">
                      Bonjour,<br>
                      Une alerte de stock a été déclenchée pour le produit ci-dessous.
                    </p>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; margin: 16px 0;">
                      <tr>
                        <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">Produit</td>
                        <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #111827; font-weight: bold;" align="right">${productName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">Catégorie</td>
                        <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #111827;" align="right">${category}</td>
                      </tr>
                      <tr>
                        <td style="padding: 14px 16px; font-size: 12px; color: #6b7280;">Quantité restante</td>
                        <td style="padding: 14px 16px; font-size: 14px; color: ${accent}; font-weight: bold;" align="right">${quantity} unité(s)</td>
                      </tr>
                    </table>

                    <p style="margin: 16px 0 24px; font-size: 13px; color: #4b5563; line-height: 1.6;">
                      ${message}
                    </p>

                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color: #111827; border-radius: 4px;">
                          <a href="${adminUrl}/admin/products" style="display: inline-block; padding: 10px 20px; font-size: 13px; color: #ffffff; text-decoration: none; font-weight: bold;">Gérer le stock</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Pied de page -->
                <tr>
                  <td style="padding: 16px 28px; border-top: 1px solid #e2e2e2; font-size: 11px; color: #9ca3af;">
                    © ${new Date().getFullYear()} SRED - Emballages et Décors · Message automatique, ne pas répondre.
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

/**
 * Envoyer une alerte de stock faible ou rupture à l'administrateur principal.
 */
export async function sendStockAlertEmail(
  productName: string,
  category: string,
  quantity: number,
  threshold: number = 10
) {
  const isOutOfStock = quantity === 0;
  const isLowStock = quantity > 0 && quantity < threshold;

  if (!isOutOfStock && !isLowStock) {
    console.log(`Stock suffisant pour ${productName} (${quantity}), pas d'alerte`);
    return false;
  }

  const ADMIN_URL = process.env.APP_URL || "http://localhost:5173";
  const subject = isOutOfStock
    ? `Rupture de stock - ${productName}`
    : `Stock faible - ${productName} (${quantity} restants)`;

  const mailOptions = {
    from: `"SRED - Alerte Stock" <${SMTP_USER}>`,
    to: SMTP_USER,
    subject,
    html: buildStockAlertHtml(productName, category, quantity, threshold, ADMIN_URL),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email d'alerte de stock envoyé pour ${productName}:`, info.messageId);
    return true;
  } catch (error: any) {
    console.error(`Erreur lors de l'envoi de l'alerte de stock pour ${productName}:`, error.message);
    return false;
  }
}

/**
 * Envoyer une alerte de stock à tous les administrateurs.
 */
export async function sendStockAlertToAdmins(
  productName: string,
  category: string,
  quantity: number,
  adminEmails: string[],
  threshold: number = 10
) {
  if (adminEmails.length === 0) {
    console.log("Aucun admin trouvé pour envoyer l'alerte de stock");
    return false;
  }

  const isOutOfStock = quantity === 0;
  const isLowStock = quantity > 0 && quantity < threshold;

  if (!isOutOfStock && !isLowStock) return false;

  const ADMIN_URL = process.env.APP_URL || "http://localhost:5173";
  const subject = isOutOfStock
    ? `Rupture de stock - ${productName}`
    : `Stock faible - ${productName} (${quantity} restants)`;

  const mailOptions = {
    from: `"SRED - Alerte Stock" <${SMTP_USER}>`,
    to: adminEmails.join(", "),
    subject,
    html: buildStockAlertHtml(productName, category, quantity, threshold, ADMIN_URL),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email d'alerte de stock envoyé aux admins pour ${productName}:`, info.messageId);
    return true;
  } catch (error: any) {
    console.error(`Erreur lors de l'envoi de l'alerte de stock pour ${productName}:`, error.message);
    return false;
  }
}