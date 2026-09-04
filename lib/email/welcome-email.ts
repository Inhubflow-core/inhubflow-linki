/**
 * InHubFlow B2B Suite - Welcome Email Delivery Service via Resend
 */

export interface WelcomeEmailParams {
  to: string;
  companyName?: string;
  password: string;
  planTier: string;
  slotsLimit: number;
  loginUrl?: string;
}

export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<{ success: boolean; id?: string; error?: string }> {
  const {
    to,
    companyName,
    password,
    planTier,
    slotsLimit,
    loginUrl = "https://b2b.inhubflow.online/login",
  } = params;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[Resend Welcome Email] ⚠️ RESEND_API_KEY no está configurada en las variables de entorno.");
    return { success: false, error: "RESEND_API_KEY no configurada en el servidor" };
  }
  const primaryFrom = process.env.RESEND_FROM_EMAIL || "InHubFlow B2B Suite <info@inhubflow.online>";

  const planName =
    planTier === "business"
      ? "Plan Business (10 Cuentas)"
      : planTier === "growth"
      ? "Plan Growth (5 Cuentas)"
      : planTier === "starter"
      ? "Plan Starter (1 Cuenta)"
      : `Plan Personalizado (${slotsLimit} Slots)`;

  const displayName = companyName ? companyName : to.split("@")[0];

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bienvenido a InHubFlow B2B Suite</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e5e7eb;">
          
          <!-- Brand Header (Matching Platform Dark Footer) -->
          <tr>
            <td style="background-color: #060814; background: linear-gradient(180deg, #050814 0%, #080d22 100%); padding: 36px 30px; text-align: center; border-bottom: 1px solid #1e293b;">
              <table role="presentation" width="100%">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; background-color: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.3); border-radius: 9999px; padding: 4px 14px; margin-bottom: 16px;">
                      <span style="color: #60a5fa; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;">B2B Outreach Engine</span>
                    </div>
                    <div style="margin: 0 auto; text-align: center;">
                      <a href="${loginUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                        <img src="https://b2b.inhubflow.online/logo-master-dark.png" alt="inhubflow" width="180" style="display: block; margin: 0 auto; max-width: 180px; height: auto; border: 0;" />
                      </a>
                    </div>
                    <p style="margin: 12px 0 0 0; color: #94a3b8; font-size: 13px;">Plataforma de Prospección Comercial &amp; Asistente SDR IA</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 36px 30px;">
              <h2 style="margin: 0 0 12px 0; color: #111827; font-size: 20px; font-weight: 700;">
                ¡Hola, ${displayName}! 👋
              </h2>
              <p style="margin: 0 0 18px 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                Tu espacio de trabajo en <strong>InHubFlow B2B Suite</strong> ha sido activado con éxito. Ya puedes comenzar a automatizar tus campañas de LinkedIn, prospección multicanal y agendamiento comercial con Inteligencia Artificial.
              </p>

              <!-- Spam Notice Alert -->
              <table role="presentation" width="100%" style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 13px 16px;">
                    <p style="margin: 0; font-size: 12px; color: #0369a1; line-height: 1.5;">
                      📬 <strong>Aviso importante:</strong> Si este correo llegó a tu carpeta de <em>Spam</em> o <em>Promociones</em>, por favor haz clic en <strong>&quot;No es spam&quot;</strong> o muévelo a tu <em>Bandeja Principal</em>. Esto garantizará que recibas los reportes y notificaciones de tus campañas sin demoras.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Credentials Box -->
              <table role="presentation" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <p style="margin: 0 0 14px 0; font-size: 12px; font-weight: 700; color: #2563eb; text-transform: uppercase; letter-spacing: 1px;">
                      🔐 Tus Credenciales de Acceso
                    </p>
                    
                    <table role="presentation" width="100%" style="font-size: 14px;">
                      <tr>
                        <td style="padding: 6px 0; color: #64748b; width: 35%; font-weight: 600;">Plataforma:</td>
                        <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">
                          <a href="${loginUrl}" target="_blank" style="color: #2563eb; text-decoration: none;">b2b.inhubflow.online</a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Usuario / Email:</td>
                        <td style="padding: 6px 0; color: #0f172a; font-weight: 700; font-family: monospace; font-size: 13px;">
                          ${to}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Contraseña:</td>
                        <td style="padding: 6px 0;">
                          <span style="background-color: #e0e7ff; color: #3730a3; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-family: monospace; font-size: 14px; letter-spacing: 0.5px;">
                            ${password}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Plan Activado:</td>
                        <td style="padding: 6px 0; color: #059669; font-weight: 700;">
                          ${planName} (${slotsLimit} Slots)
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <a href="${loginUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 14px rgba(37,99,235,0.35);">
                      Ingresar a mi Plataforma &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Next Steps -->
              <div style="border-top: 1px solid #f1f5f9; padding-top: 20px; margin-bottom: 20px;">
                <p style="margin: 0 0 10px 0; font-size: 13px; font-weight: 700; color: #111827;">
                  🚀 Primeros pasos recomendados:
                </p>
                <ol style="margin: 0; padding-left: 18px; color: #4b5563; font-size: 13px; line-height: 1.6;">
                  <li style="margin-bottom: 4px;">Inicia sesión con tu correo y tu contraseña temporal.</li>
                  <li style="margin-bottom: 4px;">Ve a <strong>Configuración &gt; LinkedIn</strong> para conectar tu cuenta o las de tu equipo.</li>
                  <li style="margin-bottom: 4px;">Usa el <strong>Lead Finder</strong> para crear listas de contactos calificados.</li>
                  <li>Configura tu <strong>Asistente SDR con IA</strong> para automatizar el seguimiento de prospectos.</li>
                </ol>
              </div>

              <!-- Security Notice -->
              <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 14px;">
                <p style="margin: 0; font-size: 12px; color: #92400e; line-height: 1.5;">
                  💡 <strong>Recomendación de seguridad:</strong> Puedes cambiar tu contraseña temporal en cualquier momento desde el menú de <em>Configuración &gt; General</em>.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 30px; text-align: center;">
              <p style="margin: 0 0 6px 0; color: #64748b; font-size: 12px;">
                ¿Necesitas ayuda o soporte para configurar tus campañas?
              </p>
              <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                Escríbenos directamente respondiendo a este correo o contacta a <a href="mailto:soporte@inhubflow.online" style="color: #2563eb; text-decoration: none;">soporte@inhubflow.online</a>
              </p>
              <p style="margin: 10px 0 4px 0; color: #94a3b8; font-size: 10px;">
                Este es un correo transaccional generado automáticamente por la activación de tu cuenta corporativa.
              </p>
              <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 10px; text-transform: uppercase; letter-spacing: 1px;">
                &copy; 2026 InHubFlow B2B Suite • inhubflow.online
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const textContent = `
Hola ${displayName},

Tu espacio de trabajo en InHubFlow B2B Suite ha sido activado con éxito. Ya puedes comenzar a automatizar tus campañas de LinkedIn, prospección multicanal y agendamiento comercial con Inteligencia Artificial.

IMPORTANTE: Si este mensaje llegó a tu carpeta de Spam o Correo no deseado, por favor márcalo como "No es Spam" para recibir las alertas y reportes de tus campañas en tu bandeja principal.

DATOS DE ACCESO A TU PLATAFORMA:
- Plataforma: ${loginUrl}
- Usuario / Email: ${to}
- Contraseña temporal: ${password}
- Plan Activado: ${planName} (${slotsLimit} Slots)

Para ingresar directamente a tu cuenta:
${loginUrl}

Primeros pasos recomendados:
1. Inicia sesión con tu correo y tu contraseña temporal.
2. Ve a Configuración > LinkedIn para conectar tu cuenta o las de tu equipo.
3. Usa el Lead Finder para crear listas de contactos calificados.
4. Configura tu Asistente SDR con IA para automatizar el seguimiento de prospectos.

Recomendación de seguridad: Puedes cambiar tu contraseña temporal en cualquier momento desde Configuración > General.

¿Necesitas ayuda o soporte para configurar tus campañas?
Responde directamente a este correo o escribe a soporte@inhubflow.online

---
InHubFlow B2B Suite • inhubflow.online
Este es un correo transaccional generado automáticamente por la activación de tu cuenta corporativa.
`.trim();

  const emailSubject = `Acceso a tu cuenta — InHubFlow B2B Suite (${planName})`;

  // Attempt 1: Send via official domain
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: primaryFrom,
        to: [to],
        reply_to: "info@inhubflow.online",
        subject: emailSubject,
        html,
        text: textContent,
        headers: {
          "X-Entity-Ref-ID": `welcome-${Date.now()}`,
        },
      }),
    });

    const data = await res.json();

    if (res.ok && data?.id) {
      console.log(`[Resend Welcome Email] ✅ Email successfully sent to ${to} (ID: ${data.id})`);
      return { success: true, id: data.id };
    }

    // If there's an issue with domain verification or policy, attempt fallback to onboarding@resend.dev
    console.warn("[Resend Welcome Email] ⚠️ Primary send failed, attempting fallback:", data);

    const fallbackRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "InHubFlow Suite <onboarding@resend.dev>",
        to: [to],
        reply_to: "info@inhubflow.online",
        subject: emailSubject,
        html,
        text: textContent,
      }),
    });

    const fallbackData = await fallbackRes.json();
    if (fallbackRes.ok && fallbackData?.id) {
      console.log(`[Resend Welcome Email] ✅ Fallback email successfully sent to ${to} (ID: ${fallbackData.id})`);
      return { success: true, id: fallbackData.id };
    }

    return { success: false, error: data?.message || fallbackData?.message || "Error al enviar correo" };
  } catch (err: any) {
    console.error("[Resend Welcome Email] ❌ Network exception:", err);
    return { success: false, error: err?.message || "Error de red al conectar con Resend" };
  }
}
