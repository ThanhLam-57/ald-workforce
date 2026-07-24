"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { SignOutButton } from "@/app/dashboard/sign-out-button";

type ShellNavigationItem = Readonly<{
  href: string;
  label: string;
  shortLabel: string;
  description: string;
  section: string;
}>;

type ProtectedShellProps = Readonly<{
  children: ReactNode;
  identity: Readonly<{
    name: string;
    roleLabel: string;
    scopeLabel: string;
  }>;
  navigation: readonly ShellNavigationItem[];
}>;

const COLLAPSE_KEY = "ald-navigation-collapsed";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationContent({
  collapsed,
  items,
  onNavigate,
}: Readonly<{
  collapsed: boolean;
  items: readonly ShellNavigationItem[];
  onNavigate?: () => void;
}>) {
  const pathname = usePathname();
  const sections = useMemo(() => [...new Set(items.map((item) => item.section))], [items]);

  return (
    <nav aria-label="Điều hướng chính" className="flex-1 overflow-y-auto px-3 pb-5">
      {sections.map((section) => (
        <div className="mt-5" key={section}>
          {!collapsed ? (
            <p className="px-3 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {section}
            </p>
          ) : (
            <div aria-hidden className="mx-3 border-t border-slate-200" />
          )}
          <ul className="mt-2 space-y-1">
            {items
              .filter((item) => item.section === section)
              .map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                        active
                          ? "bg-sky-50 font-semibold text-sky-800 ring-1 ring-inset ring-sky-100"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                      }`}
                      href={item.href}
                      title={collapsed ? item.label : item.description}
                      {...(onNavigate ? { onClick: onNavigate } : {})}
                    >
                      <span
                        aria-hidden
                        className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-[0.62rem] font-bold tracking-wide ${
                          active
                            ? "bg-sky-700 text-white"
                            : "bg-slate-200 text-slate-600 group-hover:bg-slate-300"
                        }`}
                      >
                        {item.shortLabel}
                      </span>
                      {!collapsed ? <span className="leading-5">{item.label}</span> : null}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function ProtectedShell({ children, identity, navigation }: ProtectedShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const activeItem = navigation.find((item) => isActive(pathname, item.href));

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "true");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(COLLAPSE_KEY, String(next));
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition focus:translate-y-0"
        href="#main-content"
      >
        Chuyển đến nội dung chính
      </a>

      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r border-slate-200 bg-white transition-[width] lg:flex lg:flex-col ${
          collapsed ? "w-20" : "w-72"
        }`}
      >
        <div className="flex h-20 items-center justify-between gap-3 border-b border-slate-100 px-5">
          <Link
            aria-label="ALD Workforce — Tổng quan"
            className="flex items-center gap-3"
            href="/dashboard"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-sky-700 text-xs font-bold tracking-wider text-white">
              ALD
            </span>
            {!collapsed ? (
              <span>
                <span className="block text-sm font-bold tracking-[0.16em] text-slate-900">
                  WORKFORCE
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">Vận hành nội bộ</span>
              </span>
            ) : null}
          </Link>
        </div>

        <NavigationContent collapsed={collapsed} items={navigation} />

        <div className="border-t border-slate-100 p-3">
          <button
            aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            className="flex w-full items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={toggleCollapsed}
            type="button"
          >
            {collapsed ? "Mở" : "Thu gọn"}
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Đóng menu"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <aside
            aria-label="Menu di động"
            aria-modal="true"
            className="relative flex h-full w-[min(88vw,21rem)] flex-col bg-white shadow-2xl"
            ref={drawerRef}
            role="dialog"
          >
            <div className="flex h-20 items-center justify-between border-b border-slate-100 px-5">
              <Link
                className="flex items-center gap-3"
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-sky-700 text-xs font-bold tracking-wider text-white">
                  ALD
                </span>
                <span className="text-sm font-bold tracking-[0.16em]">WORKFORCE</span>
              </Link>
              <button
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600"
                onClick={() => setMobileOpen(false)}
                ref={closeButtonRef}
                type="button"
              >
                Đóng
              </button>
            </div>
            <NavigationContent
              collapsed={false}
              items={navigation}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className={`min-h-screen transition-[padding] ${collapsed ? "lg:pl-20" : "lg:pl-72"}`}>
        <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur">
          <div className="flex min-h-20 items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                aria-expanded={mobileOpen}
                aria-label="Mở menu"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 lg:hidden"
                onClick={() => setMobileOpen(true)}
                type="button"
              >
                Menu
              </button>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">
                  ALD Workforce <span aria-hidden>／</span>{" "}
                  <span className="text-slate-700">{activeItem?.label ?? "Khu vực làm việc"}</span>
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                  {activeItem?.description ?? "Quản lý vận hành theo đúng phạm vi được phân công"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="max-w-48 truncate text-sm font-semibold text-slate-900">
                  {identity.name}
                </p>
                <p className="text-xs text-slate-500">
                  {identity.roleLabel} · {identity.scopeLabel}
                </p>
              </div>
              <SignOutButton />
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
