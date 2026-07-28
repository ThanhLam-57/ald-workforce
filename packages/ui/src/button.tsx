import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "soft"
  | "outline-sky"
  | "outline-violet"
  | "outline-danger"
  | "link";

export type ButtonSize = "default" | "compact";

export type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>;

const baseClassName =
  "inline-flex max-w-full items-center justify-center whitespace-normal rounded-lg text-center font-medium [overflow-wrap:anywhere] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const variantClassNames: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-slate-950 text-white hover:bg-slate-800",
  secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-100",
  soft: "bg-slate-100 text-slate-900 hover:bg-slate-200",
  "outline-sky": "bg-white text-sky-800 ring-1 ring-inset ring-sky-200 hover:bg-sky-50",
  "outline-violet":
    "bg-white text-violet-800 ring-1 ring-inset ring-violet-200 hover:bg-violet-50",
  "outline-danger": "bg-white text-rose-800 ring-1 ring-inset ring-rose-200 hover:bg-rose-50",
  link: "bg-transparent text-sky-700 hover:bg-sky-50 hover:text-sky-900",
};

const sizeClassNames: Readonly<Record<ButtonSize, string>> = {
  default: "px-4 py-2",
  compact: "px-1 py-0.5",
};

export function buttonClassName({
  variant = "primary",
  size = "default",
  className = "",
}: Readonly<Pick<ButtonProps, "variant" | "size" | "className">> = {}): string {
  return [baseClassName, sizeClassNames[size], variantClassNames[variant], className]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  children,
  className = "",
  size = "default",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClassName({ className, size, variant })}
      {...props}
    >
      {children}
    </button>
  );
}
