import { ReactNode, useState, useEffect } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import Header from "./Header";
import TourGate from "@/components/onboarding/TourGate";

const NO_LAYOUT_PATHS = ["/login"];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isEmbed = router.query.embed === "true";
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-collapse sidebar on smaller screens
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth < 1024) {
        setIsCollapsed(true);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (NO_LAYOUT_PATHS.includes(router.pathname)) {
    return <>{children}</>;
  }

  const toggleSidebar = () => {
    setIsCollapsed((prev) => !prev);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-[#0c111d] dark:text-gray-100 flex font-sans transition-colors duration-200">
      <TourGate />

      {/* Sidebar */}
      {!isEmbed && (
        <Sidebar
          isCollapsed={isCollapsed}
          onCollapse={setIsCollapsed}
          isEmbedded={isEmbed}
        />
      )}

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ${
          isEmbed ? "ml-0" : isCollapsed ? "ml-16" : "ml-64"
        }`}
      >
        {!isEmbed && (
          <Header
            onToggleSidebar={toggleSidebar}
            isSidebarCollapsed={isCollapsed}
            isEmbedded={isEmbed}
          />
        )}

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
