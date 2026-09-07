import Head from "next/head";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiVideoLine,
  RiPlayCircleLine,
  RiCustomerService2Line,
  RiCompassLine,
  RiSparklingLine,
  RiBookOpenLine,
} from "react-icons/ri";

export default function TutorialsPage() {
  const { t } = useTranslation();

  return (
    <>
      <Head>
        <title>Tutoriales — InHubFlow</title>
        <meta name="description" content="Centro de aprendizaje y tutoriales en video de InHubFlow." />
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div>
        {/* Top Header Banner (Matching other pages) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                Tutoriales y Guías
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-600 dark:text-brand-400">
                Próximamente
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Aprende a automatizar tu prospección B2B, configurar agentes SDR con IA y maximizar tus conversiones.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/support"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiCustomerService2Line size={16} /> Soporte y Tickets
            </Link>
          </div>
        </div>

        {/* Content Placeholder Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className="p-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 text-brand-500 flex items-center justify-center">
              <RiPlayCircleLine size={22} />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white text-base">
              Introducción a InHubFlow
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Descubre cómo conectar tu cuenta de LinkedIn, importar listas y configurar tus primeros flujos de prospección.
            </p>
            <span className="inline-block text-[11px] font-medium text-brand-500">Video tutorial en preparación</span>
          </div>

          <div className="p-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <RiSparklingLine size={22} />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white text-base">
              Agente SDR Autónomo con IA
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Configura tu base de conocimiento, califica prospectos automáticamente y delega respuestas inteligentes.
            </p>
            <span className="inline-block text-[11px] font-medium text-purple-500">Video tutorial en preparación</span>
          </div>

          <div className="p-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <RiBookOpenLine size={22} />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white text-base">
              Gestión de Pipeline y Kanban
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Mueve tratos, analiza el flujo comercial y visualiza cómo los prospectos avanzan de etapa en tiempo real.
            </p>
            <span className="inline-block text-[11px] font-medium text-blue-500">Video tutorial en preparación</span>
          </div>
        </div>
      </div>
    </>
  );
}
