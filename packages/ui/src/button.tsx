import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export type ButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>;

export function Button({ children, className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-lg bg-slate-950 px-4 py-2 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
