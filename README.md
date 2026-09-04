# InHubFlow

<p align="center">
  <strong>Motor Todo-en-Uno de Prospección B2B, Automatización de LinkedIn y Cold Email impulsado por IA</strong>
</p>

---

## ¿Qué es InHubFlow?

**InHubFlow** es una plataforma de prospección B2B y automatización multicanal diseñada para fundadores, consultores y agencias que buscan escalar su pipeline de ventas sin depender de herramientas desconectadas ni pagar licencias abusivas por usuario.

Permite construir secuencias multicanal sincronizadas (LinkedIn + Email), enriquecer prospectos, gestionar respuestas con un Asistente SDR de IA autónomo 24/7 y proteger las cuentas con tecnología de navegación sigilosa (Playwright Stealth).

---

## Características Principales

### 📬 Campañas Multicanal (LinkedIn + Cold Email)
- **LinkedIn + Email en una sola secuencia**: ejecuta visitas de perfil, conexiones, mensajes directos y correos en paralelo.
- **Constructor visual de flujos**: encadena pasos con tiempos de espera configurables y condiciones inteligentes.
- **A/B Testing de mensajes**: rota plantillas dinámicamente para optimizar tasas de respuesta.

### 🤖 Asistente SDR de IA 24/7 (Nativo)
- **Calificación y Respuestas Autónomas**: lee respuestas entrantes, responde dudas u objeciones frecuentes y envía enlaces de Calendly/Google Calendar cuando el prospecto está listo para agendar.
- **Bandeja de Entrada Unificada**: centraliza conversaciones de múltiples cuentas de LinkedIn y cuentas de email en un solo lugar.

### 🛡️ Máxima Seguridad y Protección Anti-Ban
- **Playwright Stealth**: navegación en la nube que simula comportamiento y huellas digitales de hardware humanas para evitar bloqueos y detecciones de bots en LinkedIn.
- **Ramp-up progresivo para email**: calentamiento gradual de bandejas SMTP para garantizar entregabilidad y 0% SPAM.
- **Límites diarios por cuenta**: respeta los límites seguros de conexión y mensajería de LinkedIn.

### 🔍 Extracción Inteligente de Leads (X-Ray & Apollo)
- **Búsqueda X-Ray Nativa**: localiza decisores B2B por cargo, ciudad y país directamente en LinkedIn sin requerir licencias de terceros.
- **Importación de Sales Navigator & CSV**: procesa listas y búsquedas respetando límites humanos.
- **Enriquecimiento con Apollo.io**: valida emails corporativos y datos empresariales en un clic.

---

## Puesta en Marcha Local

### Requisitos
- Node.js 20+ o 22+
- NPM

### Instalación
```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env.local

# 3. Iniciar en modo desarrollo
npm run dev
```

La plataforma estará disponible en `http://localhost:3000`.

---

## Despliegue con Docker

```bash
docker compose up -d --build
```

La base de datos SQLite se almacena de forma persistente en `./data/inhubflow.db`.

---

## Licencia y Propiedad

InHubFlow es una plataforma propietaria desarrollada para la gestión automatizada de prospección B2B. Todos los derechos reservados.
