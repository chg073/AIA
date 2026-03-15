"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TrendingUp,
  LayoutDashboard,
  List,
  Lightbulb,
  ArrowLeftRight,
  Settings,
  LogOut,
  Menu,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/watchlist", label: "Watchlist", icon: List },
  { href: "/dashboard/suggestions", label: "Suggestions", icon: Lightbulb },
  {
    href: "/dashboard/transactions",
    label: "Transactions",
    icon: ArrowLeftRight,
  },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const SIDEBAR_WIDTH = 256;
const EDGE_THRESHOLD = 30; // px from left edge to start swipe
const SWIPE_THRESHOLD = 80; // px to commit open/close

interface DashboardSidebarProps {
  profile: { name?: string | null } | null;
  email: string | undefined;
}

export default function DashboardSidebar({
  profile,
  email,
}: DashboardSidebarProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [translateX, setTranslateX] = useState(-SIDEBAR_WIDTH);
  const [isDragging, setIsDragging] = useState(false);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchCurrentX = useRef(0);
  const startTranslateX = useRef(-SIDEBAR_WIDTH);
  const isSwipeValid = useRef(false);

  const open = useCallback(() => {
    setIsOpen(true);
    setTranslateX(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setTranslateX(-SIDEBAR_WIDTH);
  }, []);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Touch handlers for swipe gesture
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
      touchCurrentX.current = touch.clientX;

      const fromLeftEdge = touch.clientX < EDGE_THRESHOLD;
      const sidebarOpen = isOpen;

      if (fromLeftEdge || sidebarOpen) {
        isSwipeValid.current = true;
        startTranslateX.current = sidebarOpen ? 0 : -SIDEBAR_WIDTH;
      } else {
        isSwipeValid.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isSwipeValid.current) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartX.current;
      const deltaY = touch.clientY - touchStartY.current;

      // If vertical scroll is dominant, cancel swipe
      if (!isDragging && Math.abs(deltaY) > Math.abs(deltaX)) {
        isSwipeValid.current = false;
        return;
      }

      touchCurrentX.current = touch.clientX;
      const newTranslate = Math.min(
        0,
        Math.max(-SIDEBAR_WIDTH, startTranslateX.current + deltaX)
      );

      if (!isDragging && Math.abs(deltaX) > 10) {
        setIsDragging(true);
      }

      if (isDragging || Math.abs(deltaX) > 10) {
        setTranslateX(newTranslate);
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      if (!isSwipeValid.current && !isDragging) return;

      const delta = touchCurrentX.current - touchStartX.current;

      if (isOpen) {
        if (delta < -SWIPE_THRESHOLD) {
          close();
        } else {
          open();
        }
      } else {
        if (delta > SWIPE_THRESHOLD) {
          open();
        } else {
          close();
        }
      }

      setIsDragging(false);
      isSwipeValid.current = false;
    };

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    if (!mediaQuery.matches) return;

    document.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    document.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isOpen, isDragging, open, close]);

  const backdropOpacity = Math.max(
    0,
    ((SIDEBAR_WIDTH + translateX) / SIDEBAR_WIDTH) * 0.5
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={open}
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-card border border-border shadow-md text-foreground"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile backdrop */}
      <div
        className="md:hidden fixed inset-0 z-40 bg-black pointer-events-none"
        style={{
          opacity: backdropOpacity,
          pointerEvents: isOpen ? "auto" : "none",
        }}
        onClick={close}
      />

      {/* Sidebar - desktop: always visible, mobile: pullable drawer */}
      <aside
        className="fixed h-full z-50 w-64 border-r border-border bg-card flex flex-col md:translate-x-0"
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isDragging ? "none" : "transform 0.3s ease",
        }}
      >
        {/* Use media query to override inline transform on desktop */}
        <style>{`
          @media (min-width: 768px) {
            aside[class*="z-50"][class*="w-64"] {
              transform: translateX(0) !important;
            }
          }
        `}</style>

        <div className="p-6 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2">
            <TrendingUp className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">AIA</span>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium text-sm">
              {(profile?.name || email || "U").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {profile?.name || "User"}
              </p>
              <p className="text-xs text-muted-foreground truncate">{email}</p>
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full px-3 py-2 rounded-lg hover:bg-secondary"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
